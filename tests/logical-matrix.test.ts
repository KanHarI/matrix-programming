import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compile } from '../src/compiler';
import { coefficient, logicalRow } from '../src/matrix-inspector';

describe('logical matrix coefficients relative to a diagonal default', () => {
  const template = compile('fn main(n) { return n; }');
  const artifact = { ...template, rows: [
    { cols: [0, 2], weights: [1, -2] },
    { cols: [], weights: [] },
    { cols: [0, 2], weights: [1, 3] },
  ] };

  it('omits diagonal ones but explicitly represents diagonal zero and non-unit weights', () => {
    expect(logicalRow(artifact, 0, 1)).toEqual([{ column: 2, weight: -2 }]);
    expect(logicalRow(artifact, 1, 1)).toEqual([{ column: 1, weight: 0 }]);
    // This is an absolute override of 3, not a delta of 2 relative to identity.
    expect(logicalRow(artifact, 2, 1)).toEqual([{ column: 0, weight: 1 }, { column: 2, weight: 3 }]);
  });

  it('shows every nonzero coefficient, including diagonal ones, when the default is off', () => {
    expect(logicalRow(artifact, 0, 0)).toEqual([{ column: 0, weight: 1 }, { column: 2, weight: -2 }]);
    expect(logicalRow(artifact, 1, 0)).toEqual([]);
    expect(logicalRow(artifact, 2, 0)).toEqual([{ column: 0, weight: 1 }, { column: 2, weight: 3 }]);
  });

  it('combines repeated sparse columns and omits cancelled off-diagonal coefficients', () => {
    const duplicates = { ...artifact, rows: [
      { cols: [2, 0, 1, 0, 2], weights: [7, 3, 0, -2, -7] },
      artifact.rows[1]!, artifact.rows[2]!,
    ] };
    expect(logicalRow(duplicates, 0, 1)).toEqual([]);
    expect(logicalRow(duplicates, 0, 0)).toEqual([{ column: 0, weight: 1 }]);
  });

  it.each(['parity', 'prime-simple', 'prime-binary'])('reconstructs every coefficient of %s under either default without mutation', name => {
    const a = compile(readFileSync(new URL(`../examples/${name}.matrix`, import.meta.url), 'utf8'));
    const before = JSON.stringify(a);
    for (const diagonal of [0, 1] as const) for (let row = 0; row < a.rows.length; row++) {
      const overrides = new Map(logicalRow(a, row, diagonal).map(term => [term.column, term.weight]));
      for (let column = 0; column < a.rows.length; column++) {
        expect(overrides.get(column) ?? (column === row ? diagonal : 0)).toBe(coefficient(a, row, column));
      }
    }
    expect(JSON.stringify(a)).toBe(before);
  });

  it('rejects invalid row coordinates', () => {
    for (const row of [-1, 3, 0.5, NaN]) expect(() => logicalRow(artifact, row, 1)).toThrow('out of range');
  });
});
