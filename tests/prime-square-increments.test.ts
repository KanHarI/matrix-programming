import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { compile } from '../src/compiler';
import { Machine, referenceBackend, type MatrixBackend } from '../src/runtime';
import { createWasmBackend } from '../src/wasm';
import { trialDivisionPrime } from './fixtures/original-prime';

const source = readFileSync(new URL('../examples/prime-optimized.matrix', import.meta.url), 'utf8');
// Reconstruct the previous arithmetic without changing divisibility/control logic.
// Matching assertions prevent a changed preset from silently invalidating this baseline.
expect(source).toContain('  let increment = 16;');
expect(source).toContain('    increment = increment + 8;');
expect(source).toContain('    // Test before adding');
const previousSource = source
  .replace('  let increment = 16;', '')
  .replace('    increment = increment + 8;', '')
  .replace('    // Test before adding', '    let increment = divisor + divisor + divisor + divisor + 4;\n    // Test before adding');
let backend: MatrixBackend;
beforeAll(async () => { backend = await createWasmBackend(readFileSync('public/kernel.wasm')); });

describe('optimized primality square recurrence', () => {
  // Hundreds of complete matrix runs need more than 5s on shared CI runners.
  it('agrees with trial division and the previous implementation at squares and boundaries', () => {
    const current = compile(source), previous = compile(previousSource);
    const values = new Set([
      ...Array.from({ length: 201 }, (_, n) => n),
      997, 9973, 65535, 65536, 2147483647 - 1, 2147483648, 4294967295,
    ]);
    for (const d of [3, 5, 7, 11, 17, 31, 97, 127]) {
      for (const delta of [-1, 0, 1]) values.add(d * d + delta);
    }
    for (const n of values) for (const artifact of [current, previous]) {
      const machine = new Machine(artifact, { n }, backend);
      machine.runBatch(2_000_000);
      expect(machine.error, `n=${n}`).toBeNull();
      expect(machine.status, `n=${n}`).toBe('ended');
      expect(machine.state[artifact.result!], `n=${n}`).toBe(Number(trialDivisionPrime(n)));
    }
  }, 30_000);

  it('reduces both matrix size and committed ticks for prime inputs', () => {
    const current = compile(source), previous = compile(previousSource);
    expect(current.rows.length).toBeLessThan(previous.rows.length);
    expect(current.rows.length).toBeLessThanOrEqual(286);
    for (const n of [31, 97, 997, 9973]) {
      const before = new Machine(previous, { n }, backend), after = new Machine(current, { n }, backend);
      before.runBatch(1_000_000); after.runBatch(1_000_000);
      expect(before.status).toBe('ended'); expect(after.status).toBe('ended');
      expect(after.state[current.result!]).toBe(1);
      expect(after.tick, `n=${n}`).toBeLessThan(before.tick);
    }
  });

  it('retains the u32 overflow guard at the final possible odd square', () => {
    // Exercise the actual preset transition at late-loop states through initial
    // arguments, so no long primality scan or mutation of running state is needed.
    const transition = source.match(/    \/\/ Test before adding[\s\S]*?    increment = increment \+ 8;/)?.[0];
    expect(transition).toBeDefined();
    const artifact = compile(`fn main(n, divisor, square, increment) { ${transition} return square; }`);
    for (const selected of [backend, referenceBackend]) {
      for (const d of [3, 5, 127, 65533, 65535]) {
        const square = d * d, increment = 4 * d + 4;
        for (const n of [square, Math.min(4294967295, square + increment - 1), Math.min(4294967295, square + increment), 4294967295]) {
          const machine = new Machine(artifact, { n, divisor: d, square, increment }, selected);
          machine.runBatch(1000);
          expect(machine.error).toBeNull(); expect(machine.status).toBe('ended');
          expect(machine.state[artifact.result!]).toBe(n - square < increment ? 1 : square + increment);
        }
      }
    }
  });
});
