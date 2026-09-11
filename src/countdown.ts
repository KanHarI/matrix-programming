import type { Expr, Program } from './core/ast';
import { MAX_U32, type Artifact, type CompileOptions, type SparseRow } from './core/types';

const variable = (expr: Expr, name: string) => expr.kind === 'variable' && expr.name === name;
const literal = (expr: Expr, value: number) => expr.kind === 'number' && expr.value === value;

/** Fuse a constant-stride countdown and its zero test into a small recurrence.
 *
 * This matches source structure, never a program name or a particular input.
 * A stride of two needs six coordinates; other strides need one extra zero
 * detector. The host executes the same fixed matrix at every update.
 */
export function compileCountdown(program: Program, source: string, options: CompileOptions): Artifact | undefined {
  const main = program.functions.find(fn => fn.name === 'main');
  if (!main || main.recursive || main.params.length !== 1) return;
  const inputName = main.params[0]!;
  let counter = inputName;
  let statements = main.body;
  if (statements.length === 3) {
    const declaration = statements[0]!;
    if (declaration.kind !== 'let' || declaration.size !== undefined || !declaration.value || !variable(declaration.value, inputName) || declaration.name === inputName) return;
    counter = declaration.name;
    statements = statements.slice(1);
  }
  if (statements.length !== 2) return;
  const loop = statements[0]!, returned = statements[1]!;
  if (loop.kind !== 'while' || returned.kind !== 'return' || loop.body.length !== 1) return;
  const condition = loop.condition;
  if (condition.kind !== 'binary' || condition.op !== '>=' || !variable(condition.left, counter) || condition.right.kind !== 'number') return;
  const stride = condition.right.value;
  if (!Number.isInteger(stride) || stride < 2 || stride > 0x7fff_ffff) return;
  const update = loop.body[0]!;
  if (update.kind !== 'assign' || !variable(update.target, counter)) return;
  const decrement = update.value;
  if (decrement.kind !== 'binary' || decrement.op !== '-' || !variable(decrement.left, counter) || !literal(decrement.right, stride)) return;
  const check = returned.value;
  if (check.kind !== 'binary' || !['==', '!='].includes(check.op) || !variable(check.left, counter) || !literal(check.right, 0)) return;

  // At the first state with counter < stride, b-a becomes one. The
  // corresponding result is delayed by the same update as this end detector,
  // so saturated subtraction never erases the remainder before it is observed.
  const rows: SparseRow[] = [
    { cols: [0, 5], weights: [1, -stride] },
    { cols: [5, 0], weights: [stride - 1, -1] },
    { cols: [5, 0], weights: [stride, -1] },
    stride === 2
      ? check.op === '==' ? { cols: [1], weights: [1] } : { cols: [2, 1], weights: [1, -2] }
      : check.op === '==' ? { cols: [6], weights: [1] } : { cols: [2, 1, 6], weights: [1, -1, -1] },
    { cols: [2, 1], weights: [1, -1] },
    { cols: [5], weights: [1] },
  ];
  const registers: Artifact['registers'] = [
    { name: `main.main.${counter}`, kind: 'data', bound: MAX_U32, line: loop.line, context: 'main' },
    { name: 'countdown.belowStrideMinusOne', kind: 'temporary', bound: stride - 1, line: loop.line, context: 'main' },
    { name: 'countdown.belowStride', kind: 'temporary', bound: stride, line: loop.line, context: 'main' },
    { name: 'main.main.result', kind: 'data', bound: 1, line: returned.line, context: 'main' },
    { name: 'end', kind: 'control', bound: 1, line: returned.line, context: 'main' },
    { name: 'constant.1', kind: 'constant', bound: 1, line: main.line, context: 'main' },
  ];
  if (stride !== 2) {
    rows.push({ cols: [5, 0], weights: [1, -1] });
    registers.push({ name: 'countdown.isZero', kind: 'temporary', bound: 1, line: returned.line, context: 'main' });
  }
  const initial = registers.map(() => 0);
  initial[5] = 1;
  return {
    version: 1, name: options.name ?? 'Matrix program', source, rows, registers, initial,
    inputs: { [inputName]: 0 }, result: 3, end: 4,
    led: options.devices?.led === false ? undefined : 3, devices: {},
    markers: [{ register: 0, line: loop.line, label: `count down by ${stride}`, context: 'main' }],
    stats: { instructions: 0, contexts: 1, functionInstances: ['main.main'] },
  };
}
