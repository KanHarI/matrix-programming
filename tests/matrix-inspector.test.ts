import { describe, expect, test } from 'vitest';
import { compile } from '../src/compiler';
import { coefficient, matrixCsv, matrixJson } from '../src/matrix-inspector';

describe('matrix inspection uses the actual coefficients', () => {
  const a = compile('fn main(n) { return n - 1; }');
  test('reads positive, negative, and omitted zero weights', () => {
    let negative = false, positive = false, zero = false;
    a.rows.forEach((row, r) => {
      row.cols.forEach((col, i) => {
        expect(coefficient(a, r, col)).toBe(row.weights[i]);
        negative ||= row.weights[i] < 0; positive ||= row.weights[i] > 0;
      });
      const absent = a.rows.findIndex((_, c) => !row.cols.includes(c));
      if (absent >= 0) { expect(coefficient(a, r, absent)).toBe(0); zero = true; }
    });
    expect([negative, positive, zero]).toEqual([true, true, true]);
  });
  test('rejects invalid coordinates', () => {
    for (const [r, c] of [[-1, 0], [a.rows.length, 0], [0, a.rows.length], [0.5, 0]]) expect(() => coefficient(a, r, c)).toThrow('out of range');
  });
  test('JSON preserves all sparse rows, names and input metadata', () => {
    const decoded = JSON.parse(matrixJson(a));
    expect(decoded.rows).toEqual(a.rows); expect(decoded.registers).toEqual(a.registers);
    expect(decoded.shape).toEqual([a.rows.length, a.rows.length]); expect(decoded.inputs).toEqual(a.inputs);
  });
  test('CSV includes every stored coefficient with row/source orientation', () => {
    const lines = matrixCsv(a).trimEnd().split('\n');
    expect(lines.length).toBe(1 + a.rows.reduce((n, r) => n + r.cols.length, 0));
    expect(lines[0]).toBe('destination_index,source_index,weight,destination_name,source_name');
  });
});
