import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compile } from '../src/compiler';

const matrixOf = (source: string) => {
  const artifact = compile(source);
  return { rows: artifact.rows, initial: artifact.initial, registers: artifact.registers, devices: artifact.devices };
};

describe('compiled matrix size and feature omission', () => {
  // These ceilings guard circuit size, not compressed file size or sparse entry
  // storage. They were established after removing per-instruction delay banks,
  // threading jumps, coalescing expression copies, and specializing constants.
  it.each([
    ['parity', 6], ['prime-simple', 95], ['prime-optimized', 306],
    ['hello', 209], ['greeting', 2543], ['parallel', 206],
  ] as const)('%s stays below its %i-coordinate circuit budget', (name, budget) => {
    const source = readFileSync(new URL(`../examples/${name}.matrix`, import.meta.url), 'utf8');
    expect(compile(source).registers.length).toBeLessThanOrEqual(budget);
  });

  it('unused function declarations add no matrix coordinates or entries', () => {
    const main = 'fn main(n) { return n; }';
    const unused = `
      fn storage() { let letters[64]; letters[1] = 65; return letters[1]; }
      fn peripherals() { print("unused"); pixel(0, 0, 1, 2, 3); return read(); }
      fn helper(n) { return n + 1; }
      fn concurrency() { let (a, b) = parallel { helper(1), helper(2) }; return a + b; }
    `;
    expect(matrixOf(main + unused)).toEqual(matrixOf(main));
  });

  it('enabling unused devices or hiding the LED does not change W or its dimension', () => {
    const source = 'fn main(n) { return n; }';
    const enabled = compile(source, { devices: { consoleOutput: true, consoleInput: true, screen: true, led: true } });
    const disabled = compile(source, { devices: { consoleOutput: false, consoleInput: false, screen: false, led: false } });
    expect(enabled.rows).toEqual(disabled.rows);
    expect(enabled.initial).toEqual(disabled.initial);
    expect(enabled.registers).toEqual(disabled.registers);
    expect(enabled.devices).toEqual({});
    expect(disabled.devices).toEqual({});
    expect(enabled.led).toBe(enabled.result);
    expect(disabled.led).toBeUndefined();
  });

  it('a branchless, call-free program has no unused predicate, stack, call, fork, or peripheral circuitry', () => {
    const artifact = compile('fn main(n) { return n; }');
    expect(artifact.stats.contexts).toBe(1);
    expect(artifact.stats.functionInstances).toEqual(['main.main']);
    const names = artifact.registers.map(register => register.name).join('\n');
    expect(names).not.toMatch(/returnAddress|\.done|fork|stack|console|screen|alu\.nonzero|alu\.minusOne|alu\.copy/);
    expect(artifact.devices).toEqual({});
  });

  it('does not allocate an execution pulse and nine delay registers for every instruction', () => {
    const artifact = compile('fn main(n) { if (n > 0) { return n + 1; } return 0; }');
    expect(artifact.registers.some(register => register.name.includes('.execute.'))).toBe(false);
    expect(artifact.registers.some(register => /^instruction\..*\.phase\./.test(register.name))).toBe(false);
    expect(artifact.registers.filter(register => register.name.startsWith('clock.'))).toHaveLength(11);
  });

  it('does not emit a separate copy instruction for a single-use expression temporary', () => {
    const artifact = compile('fn increment(n) { let value = n + 1; return value; } fn main(n) { return increment(n); }');
    expect(artifact.markers.filter(marker => marker.label.startsWith('write main.increment.') && marker.label !== 'write main.increment.n')).toHaveLength(2);
  });

  it('uses fewer coordinates when a comparison is only a branch condition', () => {
    const direct = compile('fn main(n) { if (n > 2) { return 1; } return 0; }');
    const materialized = compile('fn main(n) { let condition = n > 2; if (condition) { return 1; } return 0; }');
    expect(direct.registers.length).toBeLessThan(materialized.registers.length);
  });
});
