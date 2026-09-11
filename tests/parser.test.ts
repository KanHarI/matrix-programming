import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from '../src/parser';

describe('Chevrotain source parser', () => {
  it.each(['parity', 'prime-simple', 'prime-optimized', 'hello', 'greeting', 'parallel'])('parses the %s example', name => {
    const ast = parse(readFileSync(new URL(`../examples/${name}.matrix`, import.meta.url), 'utf8'));
    expect(ast.functions.some(fn => fn.name === 'main')).toBe(true);
  });
  it('preserves operator precedence and left-associative saturating subtraction', () => {
    const ast = parse('fn main(n: nat) -> nat { return n - 2 + 1 >= 4; }');
    expect(ast.functions[0]!.body[0]).toMatchObject({ kind: 'return', value: {
      kind: 'binary', op: '>=', left: { op: '+', left: { op: '-' } }, right: { value: 4 },
    } });
  });
  it('retains locations, string escapes, and keyword-prefix identifiers', () => {
    const ast = parse('// comment\nfn main() { let returnValue = 1; print("hello\\n\\u0041"); return returnValue; }');
    expect(ast.functions[0]!.line).toBe(2);
    expect(ast.functions[0]!.body[1]).toMatchObject({ kind: 'expr', expression: { args: [{ value: 'hello\nA' }] } });
  });
  it('parses bounded arrays and structured parallel bindings', () => {
    const ast = parse('fn main(n) { let a[8]; a[n] = n; let (x, y) = parallel { f(n), f(2) }; return a[x]; }');
    expect(ast.functions[0]!.body[0]).toMatchObject({ kind: 'let', size: 8 });
    expect(ast.functions[0]!.body[1]).toMatchObject({ kind: 'assign', target: { kind: 'index', name: 'a' } });
    expect(ast.functions[0]!.body[2]).toMatchObject({ kind: 'parallelLet', names: ['x', 'y'] });
  });
  it('records explicitly recursive declarations for semantic checking', () => {
    expect(parse('rec fn f(n) { return f(n); }').functions[0]!.recursive).toBe(true);
  });
  it.each([
    'fn main() { return 4294967296; }',
    'fn main() { return 100000000000000000000; }',
    'fn main() { return 1e20; }',
    'fn main() { return -1; }',
    'fn main() { let a[0]; return 0; }',
    'fn main() { let a[257]; return 0; }',
    'fn main() { return 1 }',
    'fn main() { return @; }',
    'fn main() { print("unterminated); }',
    'fn main() { return 1; } garbage',
  ])('rejects invalid source with a location: %s', source => {
    expect(() => parse(source)).toThrow(/Line \d+/);
  });
  it('does not leak parse errors into subsequent valid calls', () => {
    expect(() => parse('fn broken(')).toThrow();
    expect(parse('fn main() { return 4294967295; }').functions).toHaveLength(1);
  });
  it.each([
    'fn main(n: bit) { return n; }',
    'fn main() -> bit { return 1; }',
    'fn main() { let a: char = 65; return a; }',
    'fn main(n: float) { return n; }',
  ])('rejects type annotations that cannot yet be enforced: %s', source => {
    expect(() => parse(source)).toThrow(/Line \d+: unsupported type.*only nat/);
  });
  it('accepts explicit nat local declarations', () => {
    expect(parse('fn main() { let a: nat = 1; return a; }').functions[0]!.body[0]).toMatchObject({ kind: 'let', name: 'a' });
  });
  it('reports a useful line at the end of an incomplete program', () => {
    expect(() => parse('fn main() {\n  return 1;\n')).toThrow(/Line 3, column 1/);
  });
});
