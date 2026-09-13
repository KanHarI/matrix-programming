import type { Register } from './core/types';
import type { CounterInstruction } from './counter-machine';

/** Facts hold immediately before the instruction, on every reachable execution. */
export interface CounterFacts {
  constant(register: number): number | undefined;
  /** Upper bound on a-b; Infinity means that the relation is unknown. */
  upperDifference(a: number, b: number): number;
  lessEqual(a: number, b: number): boolean;
}

/** Conservative relational analysis of a pure counter CFG, independent of source
 * names or input values. Missing map entries mean "no usable facts", not dead code.
 * Difference-bound matrices include a virtual zero coordinate. Widening prevents
 * counting through arbitrary u32 loops; a work cap falls back to no facts rather
 * than returning a partially converged (and potentially unsound) analysis.
 */
export function analyzeCounterFacts(
  code: readonly CounterInstruction[], registers: readonly Register[],
  initial: readonly number[], inputIds: Iterable<number>,
): Map<CounterInstruction, CounterFacts> {
  const empty = () => new Map<CounterInstruction, CounterFacts>();
  if (!code.length || code.length > 2000) return empty();
  if (code.some(i => !['alu', 'branch', 'jump', 'ret', 'halt'].includes(i.op)
    || (i.op === 'alu' && i.directSet === undefined && i.directDelta === undefined))) return empty();
  const ids = [...new Set(code.flatMap(i => [i.a, i.b, i.target].filter((id): id is number => id !== undefined)))];
  if (ids.length > 32 || ids.some(id => !Number.isInteger(id) || id < 0 || id >= registers.length)) return empty();
  const positions = new Map(ids.map((id, index) => [id, index]));
  const zero = ids.length, size = zero + 1;
  const inputs = new Set(inputIds), written = new Set(code.flatMap(i => i.target === undefined ? [] : [i.target]));
  // Widen through useful program-independent order boundaries before Infinity.
  // Jumping directly from a negative difference to Infinity would unnecessarily
  // lose x<=y when saturation changes x-y from -1 to zero inside a loop.
  const thresholds = [...new Set([0, 1, 0xffff_ffff,
    ...ids.map(id => initial[id]!),
    ...code.flatMap(i => [i.directDelta, i.directSet].filter((value): value is number => value !== undefined)),
  ].flatMap(value => [value, -value]))].sort((a, b) => a - b);
  thresholds.push(Infinity);
  const domain = new Float64Array(size * size).fill(Infinity);
  const at = (a: number, b: number) => a * size + b;
  for (let i = 0; i < size; i++) domain[at(i, i)] = 0;
  ids.forEach((id, p) => {
    domain[at(p, zero)] = registers[id]!.bound;
    domain[at(zero, p)] = 0;
    if (!inputs.has(id) && !written.has(id)) {
      domain[at(p, zero)] = initial[id]!;
      domain[at(zero, p)] = -initial[id]!;
    }
  });

  const normalize = (matrix: Float64Array): Float64Array | undefined => {
    for (let i = 0; i < matrix.length; i++) matrix[i] = Math.min(matrix[i]!, domain[i]!);
    for (let k = 0; k < size; k++) for (let a = 0; a < size; a++) {
      const left = matrix[at(a, k)]!;
      if (left === Infinity) continue;
      for (let b = 0; b < size; b++) {
        const bound = left + matrix[at(k, b)]!;
        if (bound < matrix[at(a, b)]!) matrix[at(a, b)] = bound;
      }
    }
    for (let i = 0; i < size; i++) if (matrix[at(i, i)]! < 0) return undefined;
    return matrix;
  };
  const beginning = domain.slice();
  ids.forEach((id, p) => {
    if (!inputs.has(id)) {
      beginning[at(p, zero)] = initial[id]!;
      beginning[at(zero, p)] = -initial[id]!;
    }
  });
  const first = normalize(beginning);
  if (!first) return empty();
  const states = new Map<CounterInstruction, Float64Array>([[code[0]!, first]]);
  const updates = new Map<CounterInstruction, number>();
  const pending = [code[0]!], queued = new Set(pending), members = new Set(code);
  let cursor = 0;

  const send = (destination: CounterInstruction | undefined, incoming: Float64Array | undefined) => {
    if (!destination || !members.has(destination) || !incoming) return;
    const old = states.get(destination);
    let next = incoming;
    if (old) {
      const changed = (updates.get(destination) ?? 0) + 1;
      next = old.slice();
      for (let i = 0; i < next.length; i++) {
        const joined = Math.max(old[i]!, incoming[i]!);
        next[i] = changed > 3 && joined > old[i]! ? thresholds.find(threshold => threshold >= joined)! : joined;
      }
      const closed = normalize(next);
      if (!closed || closed.every((bound, i) => bound === old[i])) return;
      next = closed;
      updates.set(destination, changed);
    }
    states.set(destination, next);
    if (!queued.has(destination)) { pending.push(destination); queued.add(destination); }
  };

  const refine = (before: Float64Array, a: number, b: number, op: string, truth: boolean) => {
    const result = before.slice();
    const constrain = (left: number, right: number, bound: number) => {
      result[at(left, right)] = Math.min(result[at(left, right)]!, bound);
    };
    const relation = truth ? op : ({ '<': '>=', '<=': '>', '>': '<=', '>=': '<', '==': '!=', '!=': '==' } as Record<string, string>)[op];
    if (relation === '<') constrain(a, b, -1);
    else if (relation === '<=') constrain(a, b, 0);
    else if (relation === '>') constrain(b, a, -1);
    else if (relation === '>=') constrain(b, a, 0);
    else if (relation === '==') { constrain(a, b, 0); constrain(b, a, 0); }
    else if (relation === '!=') {
      // Disequality is non-convex. It becomes a strict inequality only when
      // an existing ordering fact rules out the other half of the disjunction.
      if (before[at(a, b)]! <= 0) constrain(a, b, -1);
      else if (before[at(b, a)]! <= 0) constrain(b, a, -1);
    }
    return normalize(result);
  };

  while (cursor < pending.length) {
    if (cursor >= Math.min(20_000, code.length * 100 + 100)) return empty();
    const instruction = pending[cursor++]!;
    queued.delete(instruction);
    const before = states.get(instruction)!;
    if (instruction.op === 'ret' || instruction.op === 'halt') continue;
    if (instruction.op === 'branch') {
      const a = positions.get(instruction.a!), b = positions.get(instruction.b!);
      if (a === undefined || b === undefined) return empty();
      send(instruction.yes, refine(before, a, b, instruction.comparison!, true));
      send(instruction.no, refine(before, a, b, instruction.comparison!, false));
      continue;
    }
    if (instruction.op === 'jump') { send(instruction.next, before); continue; }
    const target = positions.get(instruction.target!);
    if (target === undefined) return empty();
    let source = before;
    const delta = instruction.directDelta;
    if (instruction.directSet === undefined && delta !== undefined && delta > 0) {
      // Only non-faulting updates have a successor; do not infer wraparound.
      const safe = before.slice();
      safe[at(target, zero)] = Math.min(safe[at(target, zero)]!, registers[instruction.target!]!.bound - delta);
      const checked = normalize(safe);
      if (!checked) continue;
      source = checked;
    }
    const after = source.slice();
    for (let other = 0; other < size; other++) {
      if (other === target) continue;
      if (instruction.directSet !== undefined) {
        after[at(target, other)] = instruction.directSet + source[at(zero, other)]!;
        after[at(other, target)] = source[at(other, zero)]! - instruction.directSet;
      } else if (delta !== undefined && delta >= 0) {
        after[at(target, other)] = source[at(target, other)]! + delta;
        after[at(other, target)] = source[at(other, target)]! - delta;
      } else {
        const amount = -delta!;
        after[at(target, other)] = Math.max(source[at(target, other)]! - amount, source[at(zero, other)]!);
        after[at(other, target)] = Math.min(source[at(other, target)]! + amount, source[at(other, zero)]!);
      }
    }
    send(instruction.next, normalize(after));
  }

  return new Map([...states].map(([instruction, matrix]) => {
    const upperDifference = (a: number, b: number) => {
      if (a === b) return 0;
      const left = positions.get(a), right = positions.get(b);
      return left === undefined || right === undefined ? Infinity : matrix[at(left, right)]!;
    };
    const facts: CounterFacts = {
      constant(id) {
        const p = positions.get(id);
        if (p === undefined) return undefined;
        const upper = matrix[at(p, zero)]!, lower = -matrix[at(zero, p)]!;
        return upper === lower ? upper : undefined;
      },
      upperDifference,
      lessEqual: (a, b) => upperDifference(a, b) <= 0,
    };
    return [instruction, facts];
  }));
}
