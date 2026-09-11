import { describe, expect, test } from 'vitest';
import { compile } from '../src/compiler';
import { Machine } from '../src/runtime';

describe('programs without control flow do not need control infrastructure', () => {
  test('constant return compiles to 2x2; identity compiles to 3x3', () => {
    for (const [source, size] of [['fn main() { return 1; }', 2], ['fn main(n) { return n; }', 3]] as const) {
      const a = compile(source);
      expect(a.rows).toHaveLength(size);
      expect(a.registers.map(r => r.name).join(' ')).not.toMatch(/clock|pc\.|returnAddress|operand|alu/);
      expect(a.stats.instructions).toBe(0);
    }
  });
  test('code after an unconditional return adds no unused devices or control infrastructure', () => {
    const minimal = compile('fn main(n) { return n; }');
    const dead = compile('fn main(n) { return n; print("unreachable"); let letters[64]; }', { devices: { consoleOutput: false } });
    expect(dead.rows).toEqual(minimal.rows); expect(dead.devices).toEqual({});
  });
  test.each([
    'n', 'n + 0', 'n - n', '(n - n) + 4294967295', '4294967295 - (n - n)',
    '(n - 4) + (10 - n)', '(n + 1) - n', '1 + (n - (n - 1))',
  ])('feed-forward %s agrees with shared-function control lowering', expression => {
    const fast = compile(`fn main(n) { return ${expression}; }`);
    const general = compile(`fn calculate(n) { return ${expression}; } fn main(n) { return calculate(n); }`);
    for (const n of [0, 1, 2, 9, 2147483648, 4294967295]) {
      const a = new Machine(fast, { n }), b = new Machine(general, { n });
      a.runBatch(30); b.runBatch(1000);
      expect(a.status, `n=${n}`).toBe(b.status);
      if (a.status === 'ended') expect(a.state[fast.result!], `n=${n}`).toBe(b.state[general.result!]);
    }
  });
  test('unused arithmetic may still fault and cannot be eliminated unsafely', () => {
    const a = compile('fn main(n) { let unused = n + 1; return 0; }');
    const m = new Machine(a, { n: 4294967295 }); m.runBatch(100);
    expect(m.status).toBe('fault'); expect(m.tick).toBe(0);
  });
  test('sequential local updates keep the correct value dependencies', () => {
    const a = compile('fn main(n) { let value = n + 2; value = value - 1; return value + value; }');
    const m = new Machine(a, { n: 10 }); m.runBatch(100);
    expect(m.status).toBe('ended'); expect(m.state[a.result!]).toBe(22);
  });
});
