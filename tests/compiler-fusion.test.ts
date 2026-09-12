import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { compile } from '../src/compiler';
import { MAX_U32 } from '../src/core/types';
import { Machine, referenceBackend, type MatrixBackend } from '../src/runtime';
import { createWasmBackend } from '../src/wasm';

let backend: MatrixBackend;
beforeAll(async () => { backend = await createWasmBackend(Uint8Array.from(readFileSync('public/kernel.wasm'))); });
function execute(source: string, inputs: Record<string, number> = {}, selectedBackend = backend) {
  const artifact = compile(source);
  const machine = new Machine(artifact, inputs, selectedBackend);
  machine.runBatch(100_000);
  expect(machine.error).toBeNull();
  expect(machine.status).toBe('ended');
  return { artifact, machine, result: machine.state[artifact.result!]! };
}
const relations: Record<string, (a: number, b: number) => boolean> = {
  '==': (a, b) => a === b, '!=': (a, b) => a !== b,
  '<': (a, b) => a < b, '<=': (a, b) => a <= b,
  '>': (a, b) => a > b, '>=': (a, b) => a >= b,
};

describe('comparison-to-branch fusion', () => {
  it.each(Object.keys(relations))('evaluates %s across the unsigned 32-bit boundaries', operator => {
    const source = `fn main(a, b) { if (a ${operator} b) { return 1; } return 0; }`;
    const artifact = compile(source);
    for (const a of [0, 1, 2147483647, 2147483648, MAX_U32]) {
      for (const b of [0, 1, 2147483647, 2147483648, MAX_U32]) {
        const machine = new Machine(artifact, { a, b }, backend);
        machine.runBatch(10_000);
        expect(machine.error).toBeNull();
        expect(machine.status).toBe('ended');
        expect(machine.state[artifact.result!], `${a} ${operator} ${b}`).toBe(Number(relations[operator]!(a, b)));
      }
    }
  });

  it('preserves both evaluated arithmetic operands before comparing them', () => {
    const source = 'fn main(a, b) { if ((a - b) > (b - a)) { return 1; } return 0; }';
    for (const [a, b] of [[0, MAX_U32], [MAX_U32, 0], [MAX_U32, MAX_U32], [1, 2], [17, 3]]) {
      expect(execute(source, { a: a!, b: b! }).result).toBe(Number(a! > b!));
    }
    const addition = 'fn main(a, b) { if ((a + 3) == (b + 2)) { return 1; } return 0; }';
    expect(execute(addition, { a: 4, b: 5 }).result).toBe(1);
    expect(execute(addition, { a: 5, b: 4 }).result).toBe(0);
  });

  it('preserves arithmetic overflow before evaluating a fused condition', () => {
    const source = 'fn main(a, b) { if ((a + 1) < b) { return 1; } return 0; }';
    for (const selectedBackend of [backend, referenceBackend]) {
      const artifact = compile(source);
      const machine = new Machine(artifact, { a: MAX_U32, b: 0 }, selectedBackend);
      machine.runBatch(10_000);
      expect(machine.status).toBe('fault');
      expect(machine.state[artifact.end]).toBe(0);
    }
  });

  it('does not execute overflowing operand arithmetic in an inactive branch', () => {
    const source = `fn main(a, enabled) {
      if (enabled) { if ((a + 1) == 0) { return 7; } }
      return 3;
    }`;
    expect(execute(source, { a: MAX_U32, enabled: 0 }).result).toBe(3);
  });

  it('samples updated values on repeated loop-condition evaluations', () => {
    const source = `fn main(n) {
      let left = 0;
      let right = n;
      let iterations = 0;
      while (left < right) {
        left = left + 1;
        right = right - 1;
        iterations = iterations + 1;
      }
      if (left == right) { return iterations + 100; }
      return iterations;
    }`;
    for (let n = 0; n <= 16; n++) expect(execute(source, { n }).result).toBe(Math.ceil(n / 2) + (n % 2 === 0 ? 100 : 0));
  });

  it('reuses comparisons across nonadjacent branches without caching stale answers', () => {
    const source = `fn main(a, b) {
      let result = 0;
      if (a < b) { result = result + 1; }
      a = a + 1;
      if (a == b) { result = result + 2; }
      b = b + 2;
      if (a < b) { result = result + 4; }
      if (a != b) { result = result + 8; }
      if (a >= b) { result = result + 16; }
      return result;
    }`;
    for (let a = 0; a < 5; a++) for (let b = 0; b < 5; b++) {
      const expected = Number(a < b) + 2 * Number(a + 1 === b) + 4 * Number(a + 1 < b + 2)
        + 8 * Number(a + 1 !== b + 2) + 16 * Number(a + 1 >= b + 2);
      expect(execute(source, { a, b }).result).toBe(expected);
    }
  });

  it('shares circuitry for identical comparisons within one function', () => {
    const source = (other: string) => `fn main(a, b, c) {
      let count = 0;
      if (a == b) { count = count + 1; }
      if (a == ${other}) { count = count + 1; }
      return count;
    }`;
    expect(compile(source('b')).registers.length).toBeLessThan(compile(source('c')).registers.length);
  });

  it('keeps call results alive while computing the other comparison operand', () => {
    const source = `
      fn successor(n) { return n + 1; }
      fn compare(a, b) { if (successor(a) < successor(b)) { return 1; } return 0; }
      fn main(a, b) { return compare(a, b) + compare(b, a); }
    `;
    expect(execute(source, { a: 2, b: 7 }).result).toBe(1);
    expect(execute(source, { a: 7, b: 7 }).result).toBe(0);
    const artifact = compile(source);
    expect(artifact.stats.functionInstances.filter(name => name.endsWith('.successor'))).toHaveLength(1);
  });

  it('isolates comparison state across simultaneous and repeated parallel calls', () => {
    const source = `
      fn nonzero(n) { if (n == 0) { return 0; } return 1; }
      fn main() {
        let index = 0;
        let total = 0;
        while (index < 3) {
          let (a, b) = parallel { nonzero(index), nonzero(2 - index) };
          total = total + a + b;
          index = index + 1;
        }
        return total;
      }
    `;
    expect(execute(source).result).toBe(4);
  });
});

describe('constant-return and constant-assignment fusion', () => {
  it.each([0, 1])('delivers console and pixel output before main returns %i', flag => {
    const source = `fn main(flag) {
      putc(65);
      if (flag) {
        pixel(3, 7, 255, 127, 0);
        putc(66);
        return 1;
      }
      putc(67);
      return 0;
    }`;
    const { artifact, machine, result } = execute(source, { flag });
    expect(result).toBe(flag);
    expect(machine.consoleText).toBe(flag ? 'AB' : 'AC');
    expect(machine.events.filter(event => event.type === 'pixel')).toHaveLength(flag);
    if (flag) expect([...machine.pixels.slice((7 * 16 + 3) * 3, (7 * 16 + 3) * 3 + 3)]).toEqual([255, 127, 0]);
    expect(machine.events.every(event => event.tick <= machine.tick)).toBe(true);
    const tick = machine.tick;
    const events = machine.events.slice();
    expect(machine.step()).toBe(false);
    expect(machine.tick).toBe(tick);
    expect(machine.events).toEqual(events);
    expect(machine.state[artifact.end]).toBe(1);
  });

  it('does not make repeated helper returns sticky after returning one', () => {
    const source = `
      fn answer(n) { if (n > 0) { return 1; } return 0; }
      fn main() {
        let first = answer(1);
        let second = answer(0);
        let third = answer(1);
        putc(65 + first);
        putc(65 + second);
        putc(65 + third);
        return first + second + third;
      }
    `;
    const { machine, result } = execute(source);
    expect(result).toBe(2);
    expect(machine.consoleText).toBe('BAB');
  });

  it('keeps main constant returns outside 0/1 correct', () => {
    const source = 'fn main(flag) { if (flag) { return 4294967295; } return 2147483648; }';
    expect(execute(source, { flag: 1 }).result).toBe(MAX_U32);
    expect(execute(source, { flag: 0 }).result).toBe(2147483648);
  });

  it('sets zero, small constants, and full-u32 constants from every initial range', () => {
    const source = `fn main(n) {
      let value = n;
      let correct = 0;
      value = 4294967295;
      if (value == 4294967295) { correct = correct + 1; }
      value = 0;
      if (value == 0) { correct = correct + 1; }
      value = 2147483648;
      if (value == 2147483648) { correct = correct + 1; }
      value = 2147483647;
      if (value == 2147483647) { correct = correct + 1; }
      value = 1;
      if (value == 1) { correct = correct + 1; }
      value = 0;
      if (value == 0) { correct = correct + 1; }
      return correct;
    }`;
    for (const n of [0, 1, 2147483647, 2147483648, MAX_U32]) expect(execute(source, { n }).result).toBe(6);
  });

  it('clears and sets the same coordinate repeatedly in a loop', () => {
    const source = `fn main(n) {
      let value = 4294967295;
      let index = 0;
      let correct = 0;
      while (index < n) {
        value = 0;
        if (value == 0) { correct = correct + 1; }
        value = 4294967295;
        if (value == 4294967295) { correct = correct + 1; }
        index = index + 1;
      }
      return correct;
    }`;
    expect(execute(source, { n: 8 }).result).toBe(16);
  });

  it('keeps phase stepping and batched execution identical with fused returns', () => {
    const source = 'fn main(n) { putc(65); if (n == 4294967295) { putc(66); return 1; } return 0; }';
    const { artifact, machine: batched } = execute(source, { n: MAX_U32 });
    const stepped = new Machine(artifact, { n: MAX_U32 }, referenceBackend);
    for (let phase = 0; phase < 30_000 && stepped.status !== 'ended'; phase++) {
      expect(stepped.stepPhase(), stepped.error ?? 'unexpected pause').toBe(true);
    }
    expect(stepped.status).toBe('ended');
    expect([...stepped.state]).toEqual([...batched.state]);
    expect(stepped.tick).toBe(batched.tick);
    expect(stepped.events).toEqual(batched.events);
    expect(stepped.consoleText).toBe('AB');
  });
});
