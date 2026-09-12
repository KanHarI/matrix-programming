import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { compile } from '../src/compiler';
import { Machine, referenceBackend, type MatrixBackend } from '../src/runtime';
import { createWasmBackend } from '../src/wasm';

let backend: MatrixBackend;
beforeAll(async () => { backend = await createWasmBackend(Uint8Array.from(readFileSync('public/kernel.wasm'))); });
const factorial = `
  fn multiply(value, times) {
    let total = 0;
    while (times > 0) {
      total = total + value;
      times = times - 1;
    }
    return total;
  }
  rec fn factorial(n) {
    if (n < 2) { return 1; }
    let previous = factorial(n - 1);
    return multiply(previous, n);
  }
  fn main(n) { return factorial(n); }
`;
function machine(source: string, inputs: Record<string, number>, recursionDepth = 16, selectedBackend = backend) {
  return new Machine(compile(source, { recursionDepth }), inputs, selectedBackend);
}
function result(machine: Machine, budget = 200_000) {
  machine.runBatch(budget);
  expect(machine.error).toBeNull();
  expect(machine.status).toBe('ended');
  return machine.state[machine.artifact.result!]!;
}

describe('bounded directly recursive function activations', () => {
  it('runs the shipped Recursive factorial preset', () => {
    const source = readFileSync(new URL('../examples/recursive-factorial.matrix', import.meta.url), 'utf8');
    expect(result(machine(source, { n: 5 }))).toBe(120);
  });

  it('computes factorial 0..12 exclusively through the fixed compiled matrix', () => {
    const artifact = compile(factorial);
    let expected = 1;
    for (let n = 0; n <= 12; n++) {
      if (n > 0) expected *= n;
      expect(result(new Machine(artifact, { n }, backend)), `factorial(${n})`).toBe(expected);
    }
    expect(artifact.stats.functionInstances.filter(name => name.includes('.factorial@'))).toHaveLength(16);
    expect(artifact.stats.functionInstances.filter(name => name.endsWith('.multiply'))).toEqual(['main.multiply']);
    expect(artifact.devices).toEqual({});
  }, 60_000);

  it('faults on factorial 13 integer overflow without wrapping or incorrectly ending', () => {
    const instance = machine(factorial, { n: 13 });
    instance.runBatch(200_000);
    expect(instance.status).toBe('fault');
    expect(instance.error).toMatch(/bound/);
    expect(instance.state[instance.artifact.end]).toBe(0);
  });

  it('allows base cases at capacity one and faults only when an extra activation is reached', () => {
    const artifact = compile(factorial, { recursionDepth: 1 });
    expect(result(new Machine(artifact, { n: 0 }, backend))).toBe(1);
    expect(result(new Machine(artifact, { n: 1 }, backend))).toBe(1);
    const exceeded = new Machine(artifact, { n: 2 }, backend);
    exceeded.runBatch(10_000);
    expect(exceeded.status).toBe('fault');
    expect(exceeded.error).toMatch(/recursion depth limit 1 exceeded/);
    expect(exceeded.state[artifact.end]).toBe(0);
    expect(artifact.stats.functionInstances.filter(name => name.includes('.factorial@'))).toHaveLength(1);
  });

  it('enforces the configured number of simultaneously live recursive activations', () => {
    const source = 'rec fn descend(n) { if (n == 0) { return 17; } return descend(n - 1); } fn main(n) { return descend(n); }';
    expect(result(machine(source, { n: 2 }, 3))).toBe(17);
    const exceeded = machine(source, { n: 3 }, 3);
    exceeded.runBatch(10_000);
    expect(exceeded.status).toBe('fault');
    expect(exceeded.error).toMatch(/recursion depth limit 3 exceeded/);
  });

  it('preserves parent locals and shares ordinary helper bodies across activation depths', () => {
    const source = `
      fn copyByCounting(n) { let total = 0; while (n > 0) { total = total + 1; n = n - 1; } return total; }
      rec fn accumulate(n) {
        let local = copyByCounting(n);
        if (n == 0) { return local; }
        let child = accumulate(n - 1);
        return local + child;
      }
      fn main(n) { return accumulate(n) + accumulate(2); }
    `;
    for (const n of [0, 1, 5]) expect(result(machine(source, { n }, 8))).toBe(n * (n + 1) / 2 + 3);
    const artifact = compile(source, { recursionDepth: 8 });
    expect(artifact.stats.functionInstances.filter(name => name.endsWith('.copyByCounting'))).toHaveLength(1);
  });

  it('resets recursive locals and return flags on multiple calls to the same depth bank', () => {
    const source = `
      rec fn count(n) {
        let local = 0;
        if (n == 0) { return local; }
        local = count(n - 1) + 1;
        return local;
      }
      fn main(n) { return count(n) + count(0) + count(n); }
    `;
    expect(result(machine(source, { n: 5 }, 6))).toBe(10);
  });

  it('reuses deeper activations sequentially for two recursive call sites', () => {
    const source = `
      rec fn tree(n) {
        if (n == 0) { return 1; }
        return tree(n - 1) + tree(n - 1);
      }
      fn main(n) { return tree(n); }
    `;
    const instance = machine(source, { n: 5 }, 6);
    expect(result(instance)).toBe(32);
    expect(instance.artifact.stats.functionInstances.filter(name => name.includes('.tree@'))).toHaveLength(6);
  });

  it('isolates recursive activation banks in simultaneous and repeated parallel branches', () => {
    const source = `
      rec fn count(n) { if (n == 0) { return 0; } return count(n - 1) + 1; }
      fn main() {
        let total = 0;
        let index = 0;
        while (index < 3) {
          let (a, b) = parallel { count(index), count(index + 1) };
          total = total + a + b;
          index = index + 1;
        }
        return total;
      }
    `;
    const instance = machine(source, {}, 4);
    expect(result(instance)).toBe(9);
    expect(instance.artifact.stats.contexts).toBe(3);
    expect(instance.artifact.stats.functionInstances.filter(name => name.includes('.count@'))).toHaveLength(8);
  });

  it('agrees between exact reference phase stepping and WASM batching', () => {
    const source = 'rec fn sum(n) { if (n == 0) { return 0; } return n + sum(n - 1); } fn main(n) { return sum(n); }';
    const batched = machine(source, { n: 3 }, 4);
    expect(result(batched)).toBe(6);
    const stepped = new Machine(batched.artifact, { n: 3 }, referenceBackend);
    for (let phase = 0; phase < 30_000 && stepped.status === 'ready'; phase++) expect(stepped.stepPhase()).toBe(true);
    expect(stepped.status).toBe('ended');
    expect([...stepped.state]).toEqual([...batched.state]);
    expect(stepped.tick).toBe(batched.tick);
  });

  it('does not allocate unused recursive definitions or depth infrastructure in ordinary programs', () => {
    const main = 'fn main(n) { return n; }';
    const unused = ' rec fn unused(n) { if (n == 0) { return 0; } return unused(n - 1); }';
    const base = compile(main);
    const extra = compile(main + unused, { recursionDepth: 32 });
    expect(extra.rows).toEqual(base.rows);
    expect(extra.registers).toEqual(base.registers);
    expect(extra.stats.functionInstances).toEqual(base.stats.functionInstances);
  });

  it('continues to reject recursion in regular functions', () => {
    expect(() => compile('fn recur(n) { return recur(n); } fn main(n) { return recur(n); }')).toThrow(/Recursion is not allowed in regular functions/);
    expect(() => compile('fn a(n) { return b(n); } fn b(n) { return a(n); } fn main(n) { return a(n); }')).toThrow(/Recursion is not allowed in regular functions/);
  });

  it('rejects mutual recursive cycles with an explicit direct-self-only explanation', () => {
    expect(() => compile('rec fn a(n) { return b(n); } rec fn b(n) { return a(n); } fn main(n) { return a(n); }')).toThrow(/Mutual recursion.*direct self/);
    expect(() => compile('rec fn a(n) { return helper(n); } fn helper(n) { return a(n); } fn main(n) { return a(n); }')).toThrow(/Mutual recursion.*direct self/);
  });

  it('rejects recursive parallel spawning instead of allocating unbounded execution contexts', () => {
    expect(() => compile('rec fn spawn(n) { let (a, b) = parallel { spawn(n), spawn(n) }; return a + b; } fn main(n) { return spawn(n); }')).toThrow(/Recursive parallel spawning is not supported/);
  });

  it.each([0, -1, 1.5, 33, Number.NaN, Infinity])('rejects invalid recursion depth %s', recursionDepth => {
    expect(() => compile(factorial, { recursionDepth })).toThrow(/recursionDepth must be an integer from 1 to 32/);
  });
});
