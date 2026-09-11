import type { Expr, Program } from './core/ast';
import { MAX_U32, type Artifact, type CompileOptions, type SparseRow } from './core/types';

/** A pure straight-line expression needs a feed-forward matrix, not a CPU. */
export function compileStraightLine(program: Program, source: string, options: CompileOptions): Artifact | undefined {
  const declaration = program.functions.find(f => f.name === 'main');
  if (!declaration) return;
  const returnAt = declaration.body.findIndex(s => s.kind === 'return');
  const fn = { ...declaration, body: returnAt < 0 ? declaration.body : declaration.body.slice(0, returnAt + 1) };
  if (fn.body.some(s => !['let', 'assign', 'return'].includes(s.kind))) return;
  if (!fn.body.some(s => s.kind === 'return')) return;
  const supported = (e: Expr): boolean => e.kind === 'number' || e.kind === 'variable' || (e.kind === 'binary' && ['+', '-'].includes(e.op) && supported(e.left) && supported(e.right));
  for (const s of fn.body) {
    if (s.kind === 'let' && (s.size !== undefined || (s.value && !supported(s.value)))) return;
    if (s.kind === 'assign' && (s.target.kind !== 'variable' || !supported(s.value))) return;
    if (s.kind === 'return' && !supported(s.value)) return;
  }
  type Node = { id: number; depth: number };
  const rows: SparseRow[] = [], initial: number[] = [], registers: Artifact['registers'] = [], depths: number[] = [];
  const inputs: Artifact['inputs'] = {}, env = new Map<string, Node>(), constants = new Map<number, Node>();
  const fail = (message: string, line: number): never => { throw new Error(`Line ${line}: ${message}`); };
  const add = (name: string, depth: number, row: SparseRow, value = 0, kind: Artifact['registers'][number]['kind'] = 'temporary', line = fn.line, bound = MAX_U32): Node => {
    const id = rows.length; rows.push(row); initial.push(value); depths.push(depth); registers.push({ name, kind, bound, line, context: 'main' }); return { id, depth };
  };
  const constant = (value: number, line: number) => {
    if (!Number.isInteger(value) || value < 0 || value > MAX_U32) fail(`Integer ${value} is outside nat (0..${MAX_U32})`, line);
    let node = constants.get(value);
    if (!node) { node = add(`constant.${value}`, 0, { cols: [], weights: [] }, value, 'constant', line, value); constants.set(value, node); }
    return node;
  };
  for (const name of fn.params) { const node = add(`main.main.${name}`, 0, { cols: [], weights: [] }, 0, 'data'); env.set(name, node); inputs[name] = node.id; }
  const delays = new Map<string, Node>();
  function align(node: Node, depth: number): Node {
    while (node.depth < depth) {
      const key = `${node.id}:${node.depth + 1}`;
      let delayed = delays.get(key);
      if (!delayed) { delayed = add(`${registers[node.id].name}.delay`, node.depth + 1, { cols: [node.id], weights: [1] }, 0, 'temporary', registers[node.id].line, registers[node.id].bound); delays.set(key, delayed); }
      node = delayed;
    }
    return node;
  }
  function expr(e: Expr): Node {
    if (e.kind === 'number') return constant(e.value, e.line);
    if (e.kind === 'variable') return env.get(e.name) ?? fail(`Unknown variable '${e.name}'`, e.line);
    if (e.kind !== 'binary') return fail('Expected an affine expression', e.line);
    const left = expr(e.left), right = expr(e.right), depth = Math.max(left.depth, right.depth);
    const a = align(left, depth), b = align(right, depth), terms = new Map<number, number>([[a.id, 1]]);
    terms.set(b.id, (terms.get(b.id) ?? 0) + (e.op === '+' ? 1 : -1));
    for (const [col, weight] of terms) if (!weight) terms.delete(col);
    return add(`main.expression.${rows.length}`, depth + 1, { cols: [...terms.keys()], weights: [...terms.values()] }, 0, 'data', e.line);
  }
  let result: Node | undefined;
  for (const s of fn.body) {
    if (s.kind === 'let') {
      if (env.has(s.name)) fail(`Duplicate local '${s.name}'`, s.line);
      const node = s.value ? expr(s.value) : constant(0, s.line); env.set(s.name, node);
    } else if (s.kind === 'assign' && s.target.kind === 'variable') {
      if (!env.has(s.target.name)) fail(`Unknown variable '${s.target.name}'`, s.line);
      env.set(s.target.name, expr(s.value));
    } else if (s.kind === 'return') { result = expr(s.value); break; }
  }
  if (!result) return;
  // All input/constant values are pulses. Delay operands to matching depths so
  // incomplete expressions cannot cause spurious checked overflows. Wait for
  // even unused arithmetic: its overflow remains observable.
  const completionDepth = Math.max(1, ...depths, result.depth);
  if (depths.every(depth => depth === 0)) rows[result.id] = { cols: [result.id], weights: [1] };
  else result = align(result, completionDepth);
  const start = constant(1, fn.line);
  const finished = align(start, completionDepth);
  registers[finished.id].name = 'end'; registers[finished.id].kind = 'control';
  return { version: 1, name: options.name ?? 'Matrix program', source, rows, registers, initial, inputs,
    result: result.id, end: finished.id, led: options.devices?.led === false ? undefined : result.id, devices: {}, markers: [],
    stats: { instructions: 0, contexts: 1, functionInstances: ['main.main'] },
  };
}

/** Remove circuitry that cannot affect a result, port, or checked fault. */
export function pruneArtifact(a: Artifact, observations: number[] = []): Artifact {
  const roots: number[] = [a.end, ...observations, ...Object.values(a.inputs), ...Object.values(a.devices).flatMap(d => Object.values(d) as number[]), ...(a.faults ?? []).map(f => f.register)];
  if (a.result !== undefined) roots.push(a.result);
  // LED visibility must never change W, so preserve the default result and any
  // explicit observer through a stable root supplied by the compiler.
  if (a.led !== undefined) roots.push(a.led);
  // Removing an otherwise unused overflowing computation changes semantics.
  a.rows.forEach((row, i) => {
    let maximum = 0n;
    row.cols.forEach((col, j) => {
      const weight = row.weights[j], constant = a.registers[col].kind === 'constant' && a.rows[col].cols.length === 1 && a.rows[col].cols[0] === col && a.rows[col].weights[0] === 1;
      maximum += BigInt(weight) * BigInt(constant ? a.initial[col] : weight > 0 ? a.registers[col].bound : 0);
    });
    if (maximum > BigInt(a.registers[i].bound)) roots.push(i);
  });
  const kept = new Set<number>(), queue = [...roots];
  while (queue.length) { const i = queue.pop()!; if (kept.has(i)) continue; kept.add(i); queue.push(...a.rows[i].cols); }
  const indices = [...kept].sort((a, b) => a - b), mapping = new Map(indices.map((old, index) => [old, index]));
  const map = (old: number) => mapping.get(old)!;
  const devices = Object.fromEntries(Object.entries(a.devices).map(([name, ports]) => [name, Object.fromEntries(Object.entries(ports as Record<string, number>).map(([port, old]) => [port, map(old)]))])) as Artifact['devices'];
  return { ...a, rows: indices.map(i => ({ cols: a.rows[i].cols.map(map), weights: a.rows[i].weights })), registers: indices.map(i => a.registers[i]), initial: indices.map(i => a.initial[i]),
    inputs: Object.fromEntries(Object.entries(a.inputs).map(([name, index]) => [name, map(index)])),
    end: map(a.end), result: a.result === undefined ? undefined : map(a.result), led: a.led === undefined ? undefined : map(a.led), devices,
    faults: a.faults?.map(f => ({ ...f, register: map(f.register) })), markers: a.markers.filter(m => kept.has(m.register)).map(m => ({ ...m, register: map(m.register) })),
  };
}
