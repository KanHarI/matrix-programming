import { describe, expect, it } from 'vitest';
import { analyzeCounterFacts } from '../src/counter-facts';
import type { CounterInstruction as Instruction } from '../src/counter-machine';
import { MAX_U32, type Register } from '../src/core/types';

const make = (op: string, fields: Partial<Instruction> = {}): Instruction => ({ op, line: 1, label: op, ...fields });
const registers = (initial: number[]): Register[] => initial.map((_, i) => ({ name: `v${i}`, kind: 'data', bound: MAX_U32 }));

function primeCounters() {
  // zero, n, divisor, count, remainder, two. Names have no role in analysis.
  const [z, n, d, t, r, two] = [0, 1, 2, 3, 4, 5];
  const initial = [0, 0, 0, 0, 0, 2], metadata = registers(initial);
  metadata[z]!.bound = 0; metadata[two]!.bound = 2;
  const stop = make('ret', { returnValue: 0 }), done = make('ret', { returnValue: 1 });
  const checkInput = make('branch', { a: n, b: two, comparison: '<', yes: stop });
  const initDivisor = make('alu', { target: d, directSet: 2 });
  const outer = make('branch', { a: d, b: n, comparison: '<', no: done });
  const initCount = make('alu', { target: t, directSet: 0 });
  const initRemainder = make('alu', { target: r, directSet: 0 });
  const inner = make('branch', { a: t, b: n, comparison: '<' });
  const incCount = make('alu', { target: t, directDelta: 1 });
  const incRemainder = make('alu', { target: r, directDelta: 1 });
  const checkRemainder = make('branch', { a: r, b: d, comparison: '==', no: inner });
  const checkCount = make('branch', { a: t, b: n, comparison: '==', yes: stop });
  const resetRemainder = make('branch', { a: r, b: z, comparison: '>', no: inner });
  const decRemainder = make('alu', { target: r, directDelta: -1, next: resetRemainder });
  const resetCount = make('branch', { a: t, b: z, comparison: '>' });
  const decCount = make('alu', { target: t, directDelta: -1 });
  const decBoth = make('alu', { target: r, directDelta: -1, next: resetCount });
  const incDivisor = make('alu', { target: d, directDelta: 1, next: outer });
  checkInput.no = initDivisor; initDivisor.next = outer; outer.yes = initCount;
  initCount.next = initRemainder; initRemainder.next = inner; inner.yes = incCount;
  inner.no = resetCount; incCount.next = incRemainder; incRemainder.next = checkRemainder;
  checkRemainder.yes = checkCount; checkCount.no = resetRemainder;
  resetRemainder.yes = decRemainder; resetCount.yes = decCount; resetCount.no = incDivisor;
  decCount.next = decBoth;
  return { initial, metadata, n, d, t, r, initDivisor, initCount, initRemainder, checkCount, checkRemainder,
    code: [checkInput, initDivisor, outer, initCount, initRemainder, inner, incCount, incRemainder, checkRemainder, checkCount, resetRemainder, decRemainder, resetCount, decCount, decBoth, incDivisor, stop, done] };
}

describe('generic counter path facts', () => {
  it('knows non-input initial words but does not specialize an input value', () => {
    const stop = make('ret'), set = make('alu', { target: 1, directSet: 5, next: stop });
    const facts = analyzeCounterFacts([set, stop], registers([0, 0]), [0, 0], [0]);
    expect(facts.get(set)!.constant(0)).toBeUndefined();
    expect(facts.get(set)!.constant(1)).toBe(0);
    expect(facts.get(stop)!.constant(1)).toBe(5);
  });

  it('proves zero at a decrement loop exit without iterating through u32 inputs', () => {
    const done = make('ret'), branch = make('branch', { a: 1, b: 0, comparison: '>', no: done });
    const decrement = make('alu', { target: 1, directDelta: -1, next: branch }); branch.yes = decrement;
    const facts = analyzeCounterFacts([branch, decrement, done], registers([0, 0]), [0, 0], [1]);
    expect(facts.get(done)!.constant(1)).toBe(0);
    expect(facts.get(decrement)!.upperDifference(0, 1)).toBeLessThanOrEqual(-1);
  });

  it('widens growing loop bounds to reach a sound fixed point', () => {
    const done = make('ret'), branch = make('branch', { a: 1, b: 2, comparison: '<', no: done });
    const increment = make('alu', { target: 1, directDelta: 1, next: branch }); branch.yes = increment;
    const facts = analyzeCounterFacts([branch, increment, done], registers([0, 0, 0]), [0, 0, 0], [2]);
    expect(facts.size).toBe(3);
    expect(facts.get(branch)!.lessEqual(1, 2)).toBe(true);
    expect(facts.get(done)!.upperDifference(1, 2)).toBe(0);
    expect(facts.get(done)!.upperDifference(2, 1)).toBe(0);
  });

  it('joins different branch constants instead of guessing one path', () => {
    const done = make('ret');
    const left = make('alu', { target: 2, directSet: 3, next: done });
    const right = make('alu', { target: 2, directSet: 5, next: done });
    const branch = make('branch', { a: 1, b: 0, comparison: '==', yes: left, no: right });
    const facts = analyzeCounterFacts([branch, left, right, done], registers([0, 0, 0]), [0, 0, 0], [1]);
    expect(facts.get(left)!.constant(1)).toBe(0);
    expect(facts.get(done)!.constant(2)).toBeUndefined();
    expect(facts.get(done)!.upperDifference(2, 0)).toBe(5);
    expect(facts.get(done)!.upperDifference(0, 2)).toBe(-3);
  });

  it('handles saturating subtraction without inferring a negative state', () => {
    const done = make('ret'), decrement = make('alu', { target: 1, directDelta: -5, next: done });
    const facts = analyzeCounterFacts([decrement, done], registers([0, 3]), [0, 3], []);
    expect(facts.get(done)!.constant(1)).toBe(0);
  });

  it('does not propagate a successor through guaranteed overflow', () => {
    const done = make('ret'), increment = make('alu', { target: 0, directDelta: 1, next: done });
    const facts = analyzeCounterFacts([increment, done], registers([MAX_U32]), [MAX_U32], []);
    expect(facts.has(increment)).toBe(true);
    expect(facts.has(done)).toBe(false);
  });

  it('proves zero reinitializations and useful ordered equalities in nested counter loops', () => {
    const p = primeCounters();
    const facts = analyzeCounterFacts(p.code, p.metadata, p.initial, [p.n]);
    expect(facts.get(p.initDivisor)!.constant(p.d)).toBe(0);
    expect(facts.get(p.initCount)!.constant(p.t)).toBe(0);
    expect(facts.get(p.checkCount)!.lessEqual(p.t, p.n)).toBe(true);
    expect(facts.get(p.checkRemainder)!.lessEqual(p.r, p.d)).toBe(true);
    expect(facts.get(p.checkRemainder)!.lessEqual(p.r, p.t)).toBe(true);
    expect(facts.get(p.initRemainder)!.constant(p.r)).toBe(0);
  });

  it('all reported facts contain concrete traces including both saturation and loop joins', () => {
    const p = primeCounters();
    const facts = analyzeCounterFacts(p.code, p.metadata, p.initial, [p.n]);
    for (const input of [0, 1, 2, 3, 4, 7, 9, 17, MAX_U32]) {
      const values = [...p.initial]; values[p.n] = input;
      let instruction: Instruction | undefined = p.code[0];
      for (let step = 0; instruction && step < 5000; step++) {
        const state = facts.get(instruction)!;
        expect(state).toBeDefined();
        for (let a = 0; a < values.length; a++) {
          const known = state.constant(a); if (known !== undefined) expect(values[a]).toBe(known);
          for (let b = 0; b < values.length; b++) expect(values[a]! - values[b]!).toBeLessThanOrEqual(state.upperDifference(a, b));
        }
        if (instruction.op === 'ret') break;
        if (instruction.op === 'branch') {
          const a: number = values[instruction.a!]!, b: number = values[instruction.b!]!;
          const yes: boolean = instruction.comparison === '<' ? a < b : instruction.comparison === '>' ? a > b : a === b;
          instruction = yes ? instruction.yes : instruction.no;
        } else {
          const target = instruction.target!;
          values[target] = instruction.directSet ?? Math.max(0, values[target]! + instruction.directDelta!);
          if (values[target]! > MAX_U32) break;
          instruction = instruction.next;
        }
      }
    }
  });

  it('declines unsupported operations and oversized domains rather than guessing facts', () => {
    expect(analyzeCounterFacts([make('call')], [], [], []).size).toBe(0);
    const code = Array.from({ length: 33 }, (_, target) => make('alu', { target, directSet: 0 }));
    expect(analyzeCounterFacts(code, registers(new Array(33).fill(0)), new Array(33).fill(0), []).size).toBe(0);
  });
});
