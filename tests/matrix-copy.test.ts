import { describe, expect, it } from 'vitest';
import { compile } from '../src/compiler';
import type { Artifact } from '../src/core/types';
import { coefficient } from '../src/matrix-inspector';
import { matrixPython, vectorPython } from '../src/matrix-copy';

describe('dense matrix copy', () => {
  it.each([
    'fn main(n) { return n; }',
    'fn main(n) { return n - 1; }',
    'fn main(n) { if (n > 1) { return 1; } return 0; }',
    'fn helper(n) { return n + 1; } fn main(n) { return helper(n); }',
    'fn main() { putc(65); return 0; }',
  ])('copies every row and column, including signed coefficients and omitted zeros: %s', source => {
    const artifact = compile(source);
    const serialized = matrixPython(artifact);
    const dense = JSON.parse(serialized) as number[][];
    expect(dense).toHaveLength(artifact.rows.length);
    dense.forEach((row, destination) => {
      expect(row).toHaveLength(artifact.rows.length);
      row.forEach((value, source) => expect(value).toBe(coefficient(artifact, destination, source)));
    });
    expect(serialized.split('\n')).toHaveLength(artifact.rows.length + 2);
  });

  it('sums repeated source entries without transposing the matrix', () => {
    const artifact = compile('fn main(n) { return n; }');
    artifact.rows = [
      { cols: [1, 1, 0], weights: [7, -3, -2] },
      { cols: [0, 0], weights: [8, -8] },
    ];
    artifact.registers = artifact.registers.slice(0, 2);
    expect(matrixPython(artifact)).toBe('[\n  [-2, 4],\n  [0, 0]\n]');
  });

  it('handles empty matrices', () => {
    const artifact = compile('fn main() { return 0; }');
    artifact.rows = []; artifact.registers = [];
    expect(matrixPython(artifact)).toBe('[]');
  });

  it('rejects huge dense copies before expanding any rows', () => {
    const artifact = { rows: new Array(3163), registers: new Array(3163) } as Artifact;
    expect(() => matrixPython(artifact)).toThrow('10,000,000-entry limit');
  });

  it('rejects invalid row dimensions, source indices, and noninteger weights', () => {
    const artifact = compile('fn main(n) { return n; }');
    const malformed = structuredClone(artifact); malformed.registers.pop();
    expect(() => matrixPython(malformed)).toThrow('dimensions');
    for (const col of [-1, 0.5, artifact.rows.length, Number.NaN]) {
      const invalid = structuredClone(artifact); invalid.rows[0] = { cols: [col], weights: [1] };
      expect(() => matrixPython(invalid)).toThrow('out of range');
    }
    for (const weight of [Number.NaN, Number.POSITIVE_INFINITY, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
      const invalid = structuredClone(artifact); invalid.rows[0] = { cols: [0], weights: [weight] };
      expect(() => matrixPython(invalid)).toThrow('safe integer');
    }
    const mismatch = structuredClone(artifact); mismatch.rows[0] = { cols: [0], weights: [] };
    expect(() => matrixPython(mismatch)).toThrow('Malformed');
  });
});

describe('vector copy', () => {
  it('preserves complete u32 values and zero coordinates in order', () => {
    const vector = new Uint32Array([0, 1, 2147483647, 2147483648, 4294967295]);
    const serialized = vectorPython(vector);
    expect(serialized).toBe('[0, 1, 2147483647, 2147483648, 4294967295]');
    expect(JSON.parse(serialized)).toEqual([...vector]);
    expect([...vector]).toEqual([0, 1, 2147483647, 2147483648, 4294967295]);
  });

  it('preserves signed BigInt integers exactly without suffixes or exponent notation', () => {
    expect(vectorPython(new BigInt64Array([-9223372036854775808n, 0n, 9223372036854775807n])))
      .toBe('[-9223372036854775808, 0, 9223372036854775807]');
    expect(vectorPython([10n ** 30n, -(10n ** 30n)])).toBe('[1000000000000000000000000000000, -1000000000000000000000000000000]');
    expect(vectorPython([0n, -1n, 4294967295n])).toBe('[0, -1, 4294967295]');
  });

  it('accepts plain array-like vectors and handles chunk boundaries', () => {
    expect(vectorPython({ 0: -2, 1: 4n, length: 2 })).toBe('[-2, 4]');
    const values = Array.from({ length: 8201 }, (_, i) => i - 4100);
    expect(JSON.parse(vectorPython(values))).toEqual(values);
    expect(vectorPython([])).toBe('[]');
    expect(vectorPython([-0])).toBe('[0]');
  });

  it('rejects noninteger, nonfinite, missing, and unsafe number coordinates', () => {
    for (const value of [0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => vectorPython([value])).toThrow('safe integer');
    }
    expect(() => vectorPython({ length: 1 })).toThrow('safe integer');
  });

  it('checks length and text caps before producing an oversized result', () => {
    for (const length of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) expect(() => vectorPython({ length })).toThrow('length');
    expect(() => vectorPython({ length: 10_000_001 })).toThrow('10,000,000-entry limit');
    const large = 10n ** 1024n;
    const repeated = new Proxy({ length: 40_000 }, { get: (target, key) => key === 'length' ? target.length : large });
    expect(() => vectorPython(repeated as ArrayLike<bigint>)).toThrow('32 MiB');
  });
});
