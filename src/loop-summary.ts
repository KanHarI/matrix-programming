import type { Expr, Program, Stmt } from './core/ast';

/** Optional algebraic summarization of pure, unit-decrement countdown loops.
 *
 * A countdown executes exactly its initial counter value times. Every other
 * distinct word decremented once per iteration therefore finishes at
 * max(word - initialCounter, 0). Keep the old counter until all those updates
 * have been emitted, then clear it. This changes the educational execution
 * trace, so the compiler enables this pass only by explicit option.
 */
export function summarizeLoops(program: Program): Program {
  const variable = (name: string, line: number): Expr => ({ kind: 'variable', name, line });
  const number = (value: number, line: number): Expr => ({ kind: 'number', value, line });

  function summarize(statement: Stmt): Stmt[] | undefined {
    if (statement.kind !== 'while') return;
    const condition = statement.condition;
    if (condition.kind !== 'binary' || !['>', '!='].includes(condition.op)
      || condition.left.kind !== 'variable' || condition.right.kind !== 'number' || condition.right.value !== 0) return;
    const counter = condition.left.name;
    const decrements = new Map<string, Stmt & { kind: 'assign' }>();
    for (const update of statement.body) {
      if (update.kind !== 'assign' || update.target.kind !== 'variable') return;
      const name = update.target.name, value = update.value;
      if (decrements.has(name) || value.kind !== 'binary' || value.op !== '-'
        || value.left.kind !== 'variable' || value.left.name !== name
        || value.right.kind !== 'number' || value.right.value !== 1) return;
      decrements.set(name, update);
    }
    const counterUpdate = decrements.get(counter);
    if (!counterUpdate) return;
    const summarized: Stmt[] = [];
    for (const [name, update] of decrements) {
      if (name === counter) continue;
      summarized.push({
        kind: 'assign', target: variable(name, update.target.line), line: update.line,
        value: { kind: 'binary', op: '-', left: variable(name, update.value.line), right: variable(counter, update.value.line), line: update.value.line },
      });
    }
    summarized.push({ kind: 'assign', target: variable(counter, counterUpdate.target.line), value: number(0, counterUpdate.value.line), line: counterUpdate.line });
    return summarized;
  }

  function transform(statements: Stmt[]): Stmt[] {
    return statements.flatMap(statement => {
      // Recognize the original body before traversing it: a loop containing a
      // nested control construct is not itself a pure decrement-only loop.
      const replacement = summarize(statement);
      if (replacement) return replacement;
      if (statement.kind === 'while') return [{ ...statement, body: transform(statement.body) }];
      if (statement.kind === 'if') return [{ ...statement, then: transform(statement.then), otherwise: transform(statement.otherwise) }];
      return [{ ...statement }];
    });
  }

  return { functions: program.functions.map(fn => ({ ...fn, body: transform(fn.body) })) };
}
