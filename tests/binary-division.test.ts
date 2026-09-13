import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { compile } from '../src/compiler';
import { Machine, referenceBackend, type MatrixBackend } from '../src/runtime';
import { createWasmBackend } from '../src/wasm';
import { trialDivisionPrime } from './fixtures/original-prime';

const source = readFileSync(new URL('../examples/prime-binary.matrix', import.meta.url), 'utf8');
const previousSource = readFileSync(new URL('../examples/prime-optimized.matrix', import.meta.url), 'utf8');
// Compile the actual source helper, not an equivalent host implementation.
const standalone = (text: string) => {
  expect(text).toContain('fn main(n)');
  return compile(text.slice(0, text.indexOf('fn main(n)')) +
    'fn main(n, divisor) { return remainder(n, divisor); }');
};
const division = standalone(source);
let wasm: MatrixBackend;
beforeAll(async () => { wasm = await createWasmBackend(readFileSync('public/kernel.wasm')); });

function run(n: number, divisor: number, backend = wasm) {
  const machine = new Machine(division, { n, divisor }, backend);
  machine.runBatch(4000);
  expect(machine.error, `${n} % ${divisor}`).toBeNull();
  expect(machine.status, `${n} % ${divisor}`).toBe('ended');
  expect(machine.state[division.result!], `${n} % ${divisor}`).toBe(n % divisor);
  return machine;
}

describe('constant-storage binary long division', () => {
  it('matches integer remainder for small dividends and nonzero divisors', () => {
    for (let n = 0; n <= 64; n++) for (let divisor = 1; divisor <= 16; divisor++) run(n, divisor);
  });

  it('handles full-u32 operands, powers of two, exact multiples, and large divisors', () => {
    const values = new Set([0, 1, 3, 65535, 65537, 2147483647, 2147483648, 4294967294, 4294967295]);
    for (let bit = 1; bit < 32; bit++) {
      values.add(2 ** bit - 1); values.add(2 ** bit); values.add(2 ** bit + 1);
    }
    for (const n of values) for (const divisor of [1, 2, 3, 65535, 65536, 2147483647, 2147483648, 4294967295]) run(n, divisor);
    let seed = 0x12345678;
    const next = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
    for (let i = 0; i < 256; i++) run(next(), next() || 1);
  });

  it('agrees on WASM and exact reference backends without overflowing intermediates', () => {
    for (const [n, divisor] of [
      [0, 1], [1, 1], [97, 3], [4294967295, 1], [4294967295, 2],
      [4294967295, 3], [4294967295, 2147483648], [4294967294, 2147483647],
      [4294967295, 4294967295], [2147483647, 2147483648],
    ]) {
      const expected = run(n!, divisor!, referenceBackend);
      const actual = run(n!, divisor!);
      expect(actual.state).toEqual(expected.state);
      expect(actual.tick).toBe(expected.tick);
    }
  });

  it('beats rebuilding doubled chunks for large quotients with fixed circuit storage', () => {
    const previous = standalone(previousSource);
    expect(division.rows.length).toBeLessThanOrEqual(207);
    expect(division.stats.functionInstances).toEqual(['main.main', 'main.remainder']);
    expect(division.devices).toEqual({});
    for (const divisor of [2, 3, 5]) {
      const before = new Machine(previous, { n: 4294967295, divisor }, wasm);
      before.runBatch(100_000);
      const after = run(4294967295, divisor);
      expect(before.status).toBe('ended');
      expect(after.tick).toBeLessThan(before.tick);
    }
  });

  it('keeps primality exact and reuses one remainder body at both call sites', () => {
    const artifact = compile(source);
    expect(artifact.rows.length).toBeLessThanOrEqual(314);
    expect(artifact.stats.functionInstances).toEqual(['main.main', 'main.remainder']);
    expect(artifact.devices).toEqual({});
    const values = new Set([
      ...Array.from({ length: 101 }, (_, n) => n),
      121, 169, 289, 997, 9973, 65535, 65536, 2147483648, 4294967295,
    ]);
    for (const n of values) {
      const machine = new Machine(artifact, { n }, wasm);
      machine.runBatch(200_000);
      expect(machine.error, `n=${n}`).toBeNull();
      expect(machine.status, `n=${n}`).toBe('ended');
      expect(machine.state[artifact.result!], `n=${n}`).toBe(Number(trialDivisionPrime(n)));
    }
  });
});
