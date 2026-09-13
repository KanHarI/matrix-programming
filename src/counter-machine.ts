import { MAX_U32, type Register } from './core/types';
import type { OptimizationFlags } from './compiler-options';
import { analyzeCounterFacts } from './counter-facts';

type Terms = [number, number][];
interface Builder {
  registers: Register[];
  initial: number[];
  add(name: string, kind?: Register['kind'], bound?: number, initial?: number, context?: string, line?: number): number;
  row(name: string, terms: Terms, bound?: number, context?: string): number;
  terms(dst: number, terms: Terms): void;
  delay(src: number, count: number, name: string, bound?: number, context?: string): number;
}
export interface CounterInstruction {
  op: string; line: number; label: string;
  a?: number; b?: number; target?: number;
  comparison?: string; directDelta?: number; directSet?: number; returnValue?: number;
  next?: CounterInstruction; yes?: CounterInstruction; no?: CounterInstruction;
  pc?: number;
}

/** Pulse-driven lowering for a call-free counter CFG. Eligibility is entirely
 * operation based. No program names, source patterns, or input values occur in
 * this backend. Unsupported operations retain the general shared-ALU backend.
 *
 * PCs are one-shot tokens, not held instruction addresses. A literal update
 * uses its token directly; branches sample differences after the incoming
 * update has committed. There is no global clock or operand/writeback mux.
 */
export function lowerCounterMachine(m: Builder, code: CounterInstruction[], end: number, result: number, zero: number, flags: OptimizationFlags, inputs: number[]): boolean {
  if (!code.every(i => i.op === 'branch' || i.op === 'jump' || i.op === 'halt'
    || (i.op === 'ret' && i.returnValue !== undefined)
    || (i.op === 'alu' && (i.directDelta !== undefined || i.directSet !== undefined)))) return false;

  const facts = flags.counterFacts ? analyzeCounterFacts(code, m.registers, m.initial, inputs) : undefined;
  for (const i of code) {
    if (i.directSet === undefined) continue;
    const old = facts?.get(i)?.constant(i.target!);
    if (old === undefined) continue;
    const delta = i.directSet - old;
    if (Math.abs(delta) > 0x7fff_ffff) continue;
    // A proved old value turns replacement into a literal delta (including a
    // no-op). The proof is for all paths/inputs, never the UI's current input.
    i.directDelta = delta;
    i.directSet = undefined;
  }

  // These inequalities must hold at EVERY instruction, not just while this
  // branch is active: a single hinge has no inactive-pulse cancellation pair.
  // Multi-stage destructive clears introduce extra data states, so disable
  // this shortcut if any such writer remains. Missing analysis is no proof.
  const globalFacts = facts?.size && !code.some(i => i.directSet !== undefined) ? [...facts.values()] : undefined;
  const globallyOrdered = (a: number, b: number) => a === zero || a === b
    || Boolean(globalFacts?.every(fact => fact.lessEqual(a, b)));
  const zeroTest = (i: CounterInstruction): { gap: Terms; zeroTrue: boolean } | undefined => {
    const a = i.a!, b = i.b!, op = i.comparison!;
    let left = op === '<' || op === '>=' ? b : a;
    let right = left === a ? b : a;
    if ((op === '==' || op === '!=') && !globallyOrdered(right, left)) [left, right] = [right, left];
    if (!globallyOrdered(right, left)) return;
    return { gap: [[left, -1], ...(right === zero ? [] : [[right, 1] as [number, number]])], zeroTrue: op === '==' || op === '<=' || op === '>=' };
  };

  const groups = new Map<CounterInstruction, CounterInstruction[]>();
  const incoming = new Map<CounterInstruction, number>();
  for (const i of code) {
    const successors = i.op === 'branch' ? [i.yes, i.no] : i.op === 'ret' || i.op === 'halt' ? [] : [i.next];
    for (const next of successors) if (next) incoming.set(next, (incoming.get(next) ?? 0) + 1);
  }
  const fusedTests = new Map<CounterInstruction, { child: CounterInstruction; parentTest: NonNullable<ReturnType<typeof zeroTest>>; childTest: NonNullable<ReturnType<typeof zeroTest>> }>();
  const fusedChildren = new Set<CounterInstruction>();
  if (flags.counterFusion) for (const i of code) {
    if (i.op !== 'branch' || fusedChildren.has(i)) continue;
    const parentTest = zeroTest(i);
    if (!parentTest) continue;
    const child = parentTest.zeroTrue ? i.yes : i.no;
    if (!child || child === i || child === code[0] || child.op !== 'branch' || incoming.get(child) !== 1 || fusedChildren.has(child)) continue;
    const childTest = zeroTest(child);
    if (!childTest) continue;
    fusedTests.set(i, { child, parentTest, childTest });
    fusedChildren.add(child);
  }
  for (const i of code) {
    if (groups.has(i)) continue;
    const group = [i]; groups.set(i, group);
    if (!flags.counterFusion || i.directDelta === undefined) continue;
    const targets = new Set([i.target]);
    let next = i.next;
    while (next && incoming.get(next) === 1 && next !== code[0] && !groups.has(next)) {
      if (next.directDelta !== undefined && !targets.has(next.target)) targets.add(next.target);
      else if (next.op !== 'ret' && next.op !== 'halt') break;
      group.push(next); groups.set(next, group);
      if (next.op === 'ret' || next.op === 'halt') break;
      next = next.next;
    }
  }
  // Inline small, independent literal updates into incoming edge expressions.
  // A complementary edge is a difference of coordinates but is still exactly
  // a 0/1 pulse. Scaling that expression requires no separate action PC.
  // Bound the scale to keep combined coefficients/accumulation comfortably
  // within i32/i64 even at the compiler's instruction-count safety limit.
  const inlined = new Set<CounterInstruction>();
  if (flags.counterFusion) for (const [first, group] of groups) {
    if (first !== group[0] || first === code[0]) continue;
    // A group ended before a repeated write for a reason. Keep that boundary
    // when threading incoming edges too; x+=1; x-=1 must still fault at MAX.
    if (first.directDelta !== undefined && code.some(previous => previous.next === first && previous.directDelta !== undefined)) continue;
    if (group.every(i => (i.directDelta !== undefined && Math.abs(i.directDelta) <= 1024)
      || i.op === 'halt' || (i.op === 'ret' && i.returnValue! <= 1024))) group.forEach(i => inlined.add(i));
  }
  const returns = new Map<number, number>();
  for (const [index, i] of code.entries()) {
    const group = groups.get(i)!;
    if (group[0] !== i || inlined.has(i) || fusedChildren.has(i)) continue;
    const sharedReturn = flags.counterFusion && i.op === 'ret' ? returns.get(i.returnValue!) : undefined;
    const pc = sharedReturn ?? m.add(`main.counter.${index}.${group.map(i => i.label).join('; ')}`, 'control', 1, index === 0 ? 1 : 0, 'main', i.line);
    if (i.op === 'ret') returns.set(i.returnValue!, pc);
    for (const instruction of group) instruction.pc = pc;
  }
  const route = (terms: Terms, destination: CounterInstruction | undefined) => {
    if (destination && inlined.has(destination)) {
      const group = groups.get(destination)!;
      for (const i of group) {
        if (i.op === 'ret' || i.op === 'halt') {
          m.terms(end, terms);
          if (i.returnValue) m.terms(result, terms.map(([id, weight]) => [id, weight * i.returnValue!]));
          return;
        }
        if (i.directDelta) m.terms(i.target!, terms.map(([id, weight]) => [id, weight * i.directDelta!]));
      }
      route(terms, group.at(-1)!.next);
      return;
    }
    if (destination?.pc === undefined) throw new Error('Internal error: missing counter destination');
    m.terms(destination.pc, terms);
  };
  const differences = new Map<string, number>();
  const difference = (a: number, b: number) => {
    if (a === b || a === zero) return zero;
    // Even a-0 needs a delay: both members of a difference pair must sample
    // the same state, including on the update that changes a data coordinate.
    const key = `${a}:${b}`;
    let id = differences.get(key);
    if (id === undefined) {
      id = m.row(`main.counter.difference.${key}`, [[a, 1], [b, -1]], MAX_U32, 'main');
      differences.set(key, id);
    }
    return id;
  };
  const emittedReturns = new Set<number>();
  for (const i of code) {
    if (inlined.has(i) || fusedChildren.has(i)) continue;
    const pc = i.pc!;
    if (i.op === 'branch') {
      const fused = fusedTests.get(i);
      if (fused) {
        const { child, parentTest, childTest } = fused;
        const total = m.delay(pc, 1, `counter.${pc}.total`, 1, 'main');
        const parentMatch = m.row(`counter.${pc}.parentMatch`, [[pc, 1], ...parentTest.gap], 1, 'main');
        // With globally nonnegative gaps, both zero tests are true exactly
        // when their sum is zero. Evaluate the conjunction in a single hinge.
        const both = m.row(`counter.${pc}.jointMatch`, [[pc, 1], ...parentTest.gap, ...childTest.gap], 1, 'main');
        route([[total, 1], [parentMatch, -1]], parentTest.zeroTrue ? i.no : i.yes);
        route([[both, 1]], childTest.zeroTrue ? child.yes : child.no);
        route([[parentMatch, 1], [both, -1]], childTest.zeroTrue ? child.no : child.yes);
        continue;
      }
      const a = i.a!, b = i.b!, op = i.comparison!;
      const equality = op === '==' || op === '!=';
      const pairs = equality ? [[a, b], [b, a]]
        : [op === '<' || op === '>=' ? [b, a] : [a, b]];
      const total = m.delay(pc, 1, `counter.${pc}.total`, 1, 'main');
      const positive: Terms = [];
      for (const [left, right] of pairs) {
        if (facts?.get(i)?.lessEqual(left, right)) continue;
        if (globallyOrdered(right, left)) {
          const equal = m.row(`counter.${pc}.equal.${left}.${right}`, [[pc, 1], [left, -1], ...(right === zero ? [] : [[right, 1] as [number, number]])], 1, 'main');
          positive.push([total, 1], [equal, -1]);
          continue;
        }
        const constant = m.registers[left].kind === 'constant' ? m.initial[left] : undefined;
        if (constant !== undefined && constant > 0 && constant <= 0x7fff_ffff) {
          const high = m.row(`counter.${pc}.threshold.high`, [[pc, constant], [right, -1]], constant, 'main');
          const low = m.row(`counter.${pc}.threshold.low`, [[pc, constant - 1], [right, -1]], constant - 1, 'main');
          positive.push([high, 1], [low, -1]);
          continue;
        }
        const base = difference(left, right);
        if (base === zero) continue;
        const gated = m.row(`counter.${pc}.difference.${left}.${right}`, [[left, 1], [right, -1], [pc, -1]], MAX_U32, 'main');
        positive.push([base, 1], [gated, -1]);
      }
      // For integer d and p in {0,1}, relu(d)-relu(d-p) is p*[d>0].
      // Both rows sample the operands and token together. Inactive branches
      // cancel exactly; neither row can exceed u32 even at its endpoints.
      // Equality sums the two directions (at most one can be positive).
      const invert = op === '==' || op === '>=' || op === '<=';
      route(positive, invert ? i.no : i.yes);
      route([[total, 1], ...positive.map(([id, weight]) => [id, -weight] as [number, number])], invert ? i.yes : i.no);
    } else if (i.op === 'ret' || i.op === 'halt') {
      if (emittedReturns.has(pc)) continue;
      emittedReturns.add(pc);
      m.terms(end, [[pc, 1]]);
      if (i.returnValue) m.terms(result, [[pc, i.returnValue]]);
    } else if (i.directSet !== undefined) {
      // Destructive assignment does not need to select/copy the old word.
      // Two signed-i32 decrements clear any u32, then add the new constant.
      // The negative endpoint -2^31 is representable even though +2^31 is not.
      // The successor cannot execute until the entire replacement commits.
      const second = m.delay(pc, 1, `counter.${pc}.clear2`, 1, 'main');
      m.terms(i.target!, [[pc, -0x8000_0000], [second, -0x7fff_ffff]]);
      let pulse = second, remaining = i.directSet;
      while (remaining > 0) {
        pulse = m.delay(pulse, 1, `counter.${pc}.set.${remaining}`, 1, 'main');
        const chunk = Math.min(remaining, 0x7fff_ffff);
        m.terms(i.target!, [[pulse, chunk]]);
        remaining -= chunk;
      }
      route([[pulse, 1]], i.next);
    } else {
      if (i.directDelta !== undefined) m.terms(i.target!, [[pc, i.directDelta]]);
      // Updates to distinct coordinates commute. They share a token without
      // combining repeated writes (which could erase saturation or overflow).
      if (i.next?.pc !== pc) route([[pc, 1]], i.next);
    }
  }
  return true;
}
