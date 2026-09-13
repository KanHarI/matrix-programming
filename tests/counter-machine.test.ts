import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { compile } from '../src/compiler';
import type { OptimizationFlags } from '../src/compiler-options';
import { MAX_U32, type Artifact } from '../src/core/types';
import { Machine, referenceBackend, type MatrixBackend } from '../src/runtime';
import { createWasmBackend } from '../src/wasm';
import { originalPrime } from './fixtures/original-prime';

let backend: MatrixBackend;
beforeAll(async () => { backend = await createWasmBackend(Uint8Array.from(readFileSync('public/kernel.wasm'))); });
const configurations = [
  { counterFacts: false, counterFusion: false },
  { counterFacts: true, counterFusion: false },
  { counterFacts: false, counterFusion: true },
  { counterFacts: true, counterFusion: true },
] as const;
const relations: Record<string, (a: number, b: number) => boolean> = {
  '==': (a, b) => a === b, '!=': (a, b) => a !== b,
  '<': (a, b) => a < b, '<=': (a, b) => a <= b,
  '>': (a, b) => a > b, '>=': (a, b) => a >= b,
};
function artifact(source: string, flags: Partial<OptimizationFlags>) {
  return compile(source, { optimizations: { countdown: false, straightLine: false, counterMachine: true, ...flags } });
}
function execute(program: Artifact, inputs: Record<string, number>, budget = 500_000) {
  const machine = new Machine(program, inputs, backend);
  machine.runBatch(budget);
  return machine;
}
function result(machine: Machine): number {
  expect(machine.error).toBeNull();
  expect(machine.status, `tick=${machine.tick}`).toBe('ended');
  return machine.state[machine.artifact.result!]!;
}

describe('clock-free counter-machine semantics', () => {
  it.each(Object.keys(relations))('preserves %s for all u32 boundary pairs and fact/fusion settings', operator => {
    const source = `fn main(a, b) { if (a ${operator} b) { return 1; } return 0; }`;
    const reference = artifact(source, { counterMachine: false });
    for (const flags of configurations) {
      const program = artifact(source, flags);
      expect(program.registers.some(register => register.name.startsWith('clock.'))).toBe(false);
      for (const a of [0, 1, 2147483647, 2147483648, MAX_U32]) for (const b of [0, 1, 2147483647, 2147483648, MAX_U32]) {
        const expected = Number(relations[operator]!(a, b));
        expect(result(execute(program, { a, b })), `${a} ${operator} ${b}`).toBe(expected);
        expect(result(execute(reference, { a, b }))).toBe(expected);
      }
    }
  });

  it('handles unrelated counter algorithms without program-name or primality assumptions', () => {
    const source = `fn main(left, right) {
      let steps = 0;
      while (left > 0) {
        left = left - 1;
        right = right - 1;
        steps = steps + 1;
      }
      if (right == 0) { if (steps == 0) { return 7; } return 11; }
      return 13;
    }`;
    const reference = artifact(source, { counterMachine: false });
    for (const flags of configurations) {
      const program = artifact(source, flags);
      for (const left of [0, 1, 4, 9]) for (const right of [0, 1, 4, 12]) {
        const expected = right <= left ? left === 0 ? 7 : 11 : 13;
        expect(result(execute(program, { left, right }))).toBe(expected);
        expect(result(execute(reference, { left, right }))).toBe(expected);
      }
    }
  });

  it('fuses nested zero-test cascades without activating untaken children', () => {
    const source = `fn main(a, b, c) {
      if (a == 0) {
        if (b == 0) { if (c == 0) { return 1; } return 2; }
        return 3;
      }
      return 4;
    }`;
    for (const flags of configurations) {
      const program = artifact(source, flags);
      for (const a of [0, 1, MAX_U32]) for (const b of [0, 1, MAX_U32]) for (const c of [0, 1, MAX_U32]) {
        expect(result(execute(program, { a, b, c }))).toBe(a ? 4 : b ? 3 : c ? 2 : 1);
      }
    }
  });

  it('handles complementary zero-test cascades and later re-evaluation', () => {
    const source = `fn main(a, b, c) {
      if (a != 0) { return 1; }
      if (b != 0) { return 2; }
      c = c - 1;
      if (c == 0) { return 3; }
      return 4;
    }`;
    for (const flags of configurations) {
      const program = artifact(source, flags);
      for (const a of [0, 1]) for (const b of [0, MAX_U32]) for (const c of [0, 1, 2, MAX_U32]) {
        expect(result(execute(program, { a, b, c }))).toBe(a ? 1 : b ? 2 : c <= 1 ? 3 : 4);
      }
    }
  });

  it('does not promote a branch-local operand ordering to a global invariant', () => {
    const source = `fn main(a, b) {
      if (a <= b) {
        if (a == b) { return 1; }
        a = a + 1;
        if (a == b) { return 2; }
        return 3;
      }
      return 4;
    }`;
    for (const flags of configurations) {
      const program = artifact(source, flags);
      for (const a of [0, 1, 2, MAX_U32]) for (const b of [0, 1, 2, MAX_U32]) {
        expect(result(execute(program, { a, b }))).toBe(a > b ? 4 : a === b ? 1 : a + 1 === b ? 2 : 3);
      }
    }
  });

  it('updates path facts when an input changes after an ordering check', () => {
    const source = `fn main(n) {
      let other = 0;
      if (n > 0) { other = 1; }
      n = 0;
      if (n == other) { return 1; }
      return 0;
    }`;
    for (const flags of configurations) {
      const program = artifact(source, flags);
      for (const n of [0, 1, 2, 2147483648, MAX_U32]) expect(result(execute(program, { n }))).toBe(Number(n === 0));
    }
  });

  it('clears arbitrary full-width inputs before setting constants when old values are unknown', () => {
    const source = `fn main(x, y, flag) {
      if (flag == 0) { x = 0; } else { x = 4294967295; }
      if (x < y) { return 1; }
      if (x == y) { return 2; }
      return 3;
    }`;
    const reference = artifact(source, { counterMachine: false });
    for (const flags of configurations) {
      const program = artifact(source, flags);
      for (const x of [0, 1, MAX_U32]) for (const y of [0, 1, MAX_U32]) for (const flag of [0, 1]) {
        const updated = flag ? MAX_U32 : 0;
        const expected = updated < y ? 1 : updated === y ? 2 : 3;
        expect(result(execute(program, { x, y, flag }))).toBe(expected);
        expect(result(execute(reference, { x, y, flag }))).toBe(expected);
      }
    }
  });

  it('does not collapse increment-then-decrement and thereby erase overflow', () => {
    const source = 'fn main(n, flag) { if (flag) { n = n + 1; n = n - 1; } return 0; }';
    for (const flags of configurations) {
      const program = artifact(source, flags);
      expect(result(execute(program, { n: MAX_U32, flag: 0 }))).toBe(0);
      expect(result(execute(program, { n: MAX_U32 - 1, flag: 1 }))).toBe(0);
      const exceeded = execute(program, { n: MAX_U32, flag: 1 });
      expect(exceeded.status).toBe('fault');
      expect(exceeded.state[program.end]).toBe(0);
      expect(execute(artifact(source, { counterMachine: false }), { n: MAX_U32, flag: 1 }).status).toBe('fault');
    }
  });

  it('does not collapse saturating decrement-then-increment into a no-op', () => {
    const source = `fn main(n, flag) {
      if (flag) { n = n - 1; n = n + 1; }
      if (n == 0) { return 0; }
      if (n == 1) { return 1; }
      return 2;
    }`;
    for (const flags of configurations) {
      const program = artifact(source, flags);
      for (const n of [0, 1, 2, MAX_U32]) for (const flag of [0, 1]) {
        const updated = flag ? Math.max(0, n - 1) + 1 : n;
        expect(result(execute(program, { n, flag }))).toBe(updated === 0 ? 0 : updated === 1 ? 1 : 2);
      }
    }
  });

  it('retains repeated-target boundaries even when another update lies between them', () => {
    const source = `fn main(n, flag) {
      let other = 0;
      if (flag) { n = n - 1; other = other + 1; n = n + 1; }
      if (n == 1) { if (other == 1) { return 1; } }
      return 0;
    }`;
    for (const flags of configurations) {
      const program = artifact(source, flags);
      expect(result(execute(program, { n: 0, flag: 1 }))).toBe(1);
      expect(result(execute(program, { n: 0, flag: 0 }))).toBe(0);
      expect(result(execute(program, { n: MAX_U32, flag: 1 }))).toBe(0);
    }
  });

  it('agrees with exact BigInt phase stepping on selected full-width and cascade cases', () => {
    const source = `fn main(a, b) {
      if (a == 0) { if (b == 0) { return 1; } }
      a = 0;
      if (a == b) { return 2; }
      return 3;
    }`;
    for (const flags of configurations) {
      const program = artifact(source, flags);
      for (const inputs of [{ a: 0, b: 0 }, { a: MAX_U32, b: 0 }, { a: 0, b: MAX_U32 }]) {
        const batched = execute(program, inputs);
        result(batched);
        const stepped = new Machine(program, inputs, referenceBackend);
        for (let phase = 0; phase < 10_000 && stepped.status === 'ready'; phase++) expect(stepped.stepPhase()).toBe(true);
        expect(stepped.status).toBe('ended');
        expect(stepped.error).toBeNull();
        expect([...stepped.state]).toEqual([...batched.state]);
        expect(stepped.tick).toBe(batched.tick);
      }
    }
  });
});

describe('source-compiled simple primality counter lowering', () => {
  const source = readFileSync(new URL('../examples/prime-simple.matrix', import.meta.url), 'utf8');
  it('agrees with the original independent recurrence for every input 0..128', () => {
    const programs = configurations.map(flags => artifact(source, flags));
    for (let n = 0; n <= 128; n++) {
      const expected = Number(originalPrime(n).prime);
      for (const program of programs) expect(result(execute(program, { n }, 2_000_000)), `n=${n}`).toBe(expected);
    }
  }, 60_000);

  it('agrees with the clocked backend on representative early, prime, and composite inputs', () => {
    const compact = artifact(source, {});
    const clocked = artifact(source, { counterMachine: false });
    for (const n of [0, 1, 2, 3, 4, 9, 17, 25, 31]) {
      expect(result(execute(compact, { n }))).toBe(result(execute(clocked, { n }, 2_000_000)));
    }
  }, 60_000);

  it('has the same matrix shape and coefficients after unrelated variable renaming', () => {
    const names: Record<string, string> = { n: 'input_value', divisor: 'candidate', count: 'position', remainder: 'residue' };
    const renamed = source.replace(/\b(n|divisor|count|remainder)\b/g, name => names[name]!);
    const first = artifact(source, {}), second = artifact(renamed, {});
    expect(second.rows).toEqual(first.rows);
    expect(second.initial).toEqual(first.initial);
    expect(second.registers.length).toBe(first.registers.length);
    expect(first.registers.length).toBeLessThanOrEqual(26);
    for (const n of [0, 2, 9, 13]) expect(result(execute(second, { input_value: n }))).toBe(Number(originalPrime(n).prime));
  });
});
