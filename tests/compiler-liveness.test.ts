import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { compile } from '../src/compiler';
import { Machine, type MatrixBackend } from '../src/runtime';
import { createWasmBackend } from '../src/wasm';

let backend: MatrixBackend;
beforeAll(async () => { backend = await createWasmBackend(Uint8Array.from(readFileSync('public/kernel.wasm'))); });
function run(source: string, n: number, budget = 100_000) {
  const artifact = compile(source);
  const machine = new Machine(artifact, { n }, backend);
  machine.runBatch(budget);
  expect(machine.error).toBeNull();
  expect(machine.status).toBe('ended');
  return { artifact, machine, result: machine.state[artifact.result!]! };
}

describe('generic temporary-register liveness allocation', () => {
  it('preserves simultaneously live operands across loops and branch joins', () => {
    const source = `fn main(n) {
      let total = 0;
      let index = 0;
      while (index < n) {
        if (index < 3) { total = total + (index + 1) + (n - index); }
        else { total = total + (index - 1) + (n - index); }
        index = index + 1;
      }
      return total;
    }`;
    for (let n = 0; n <= 12; n++) {
      let expected = 0;
      for (let index = 0; index < n; index++) expected += (index < 3 ? index + 1 : index - 1) + n - index;
      expect(run(source, n).result).toBe(expected);
    }
  });

  it('keeps caller temporaries alive across shared nested helper calls', () => {
    const source = `
      fn blossom(n) { return (n + 1) + (n + 2); }
      fn orchard(n) { return (n + 3) + blossom(n + 4) + (n + 5); }
      fn main(n) { return orchard(n) + blossom(n); }
    `;
    for (const n of [0, 1, 7, 1000]) expect(run(source, n).result).toBe(6 * n + 22);
    const artifact = compile(source);
    expect(artifact.stats.functionInstances.filter(name => name.endsWith('.blossom'))).toHaveLength(1);
  });

  it('does not share scratch storage across concurrently running function instances', () => {
    const source = `
      fn accumulate(n) {
        let total = 0;
        let index = 0;
        while (index < n) {
          total = total + (index + 1) + (n - index);
          index = index + 1;
        }
        return total;
      }
      fn main(n) {
        let (a, b) = parallel { accumulate(n), accumulate(n + 2) };
        return a + b;
      }
    `;
    for (const n of [0, 1, 8]) expect(run(source, n).result).toBe(n * (n + 1) + (n + 2) * (n + 3));
  });

  it('preserves values across dynamic-array selection branch chains', () => {
    const source = `fn main(n) {
      let values[4];
      let index = 0;
      while (index < 4) { values[index] = n + index + 1; index = index + 1; }
      return values[n - 1] + values[n];
    }`;
    for (const n of [1, 2, 3]) expect(run(source, n).result).toBe(4 * n + 1);
  });

  it('excludes an explicitly observed LED expression from scratch reuse even when hidden', () => {
    const source = 'fn main(n) { led(n + 1); let other = (n + 2) + (n + 3); return other; }';
    const { artifact, machine, result } = run(source, 10);
    expect(result).toBe(25);
    expect(machine.state[artifact.led!]).toBe(11);
    const hidden = compile(source, { devices: { led: false } });
    expect(hidden.rows).toEqual(artifact.rows);
    expect(hidden.registers).toEqual(artifact.registers);
  });

  it('retains checked overflow in an unused expression rather than eliminating its execution', () => {
    const source = 'fn arithmetic(n) { let unused = n + n; return n; } fn main(n) { return arithmetic(n); }';
    const artifact = compile(source);
    const machine = new Machine(artifact, { n: 4294967295 }, backend);
    machine.runBatch(1000);
    expect(machine.status).toBe('fault');
    expect(machine.state[artifact.end]).toBe(0);
  });

  it('reuses a small scratch bank for many non-overlapping generated expressions', () => {
    const steps = Array.from({ length: 20 }, (_, i) => `total = total + (n + ${i + 1}) + (n + ${i + 2});`).join('\n');
    const source = `fn calculations(n) { let total = 0; ${steps} return total; } fn main(n) { return calculations(n); }`;
    const { artifact, result } = run(source, 3);
    expect(result).toBe(560);
    const scratch = artifact.registers.filter(register => register.kind === 'data' && register.name.startsWith('main.calculations.scratch.'));
    expect(scratch.length).toBeGreaterThan(0);
    expect(scratch.length).toBeLessThanOrEqual(3);
    expect(scratch.every(register => register.line === undefined)).toBe(true);
  });

  it('lowers in-place literal updates directly into the retained target row', () => {
    const source = 'fn main(n) { while (n > 0) { n = n - 1; } return n; }';
    const { artifact, result } = run(source, 7);
    expect(result).toBe(0);
    const target = artifact.inputs.n!;
    const row = artifact.rows[target]!;
    expect(row.cols.some((column, index) => artifact.registers[column]!.name.endsWith('.dispatch') && row.weights[index] === -1)).toBe(true);
    expect(artifact.registers.some(register => register.name.startsWith(`main.write.${target}.`))).toBe(false);
  });

  it('checks overflow and saturating subtraction in direct literal updates', () => {
    const decrement = 'fn decrease(n) { n = n - 17; return n; } fn main(n) { return decrease(n); }';
    expect(run(decrement, 0).result).toBe(0);
    expect(run(decrement, 18).result).toBe(1);
    expect(run(decrement, 4294967295).result).toBe(4294967278);
    const increment = compile('fn increase(n) { n = n + 1; return n; } fn main(n) { return increase(n); }');
    const machine = new Machine(increment, { n: 4294967295 }, backend);
    machine.runBatch(1000);
    expect(machine.status).toBe('fault');
    expect(machine.state[increment.end]).toBe(0);
  });

  it.each([
    ['prime-simple', 95, 263, 414],
    ['prime-optimized', 306, 844, 819],
  ] as const)('keeps %s below its generic allocation circuit budget', (name, rows, entries, previousRows) => {
    const source = readFileSync(new URL(`../examples/${name}.matrix`, import.meta.url), 'utf8');
    const artifact = compile(source);
    expect(artifact.registers.length).toBeLessThanOrEqual(rows);
    expect(artifact.rows.reduce((sum, row) => sum + row.cols.length, 0)).toBeLessThanOrEqual(entries);
    expect(artifact.registers.length).toBeLessThan(previousRows * 0.6);
  });
});
