import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { compile } from '../src/compiler';

describe('primality benefits from general compiler optimization', () => {
  test.each([['prime-simple', 414], ['prime-optimized', 819]] as const)('%s is smaller without an algorithm-specific lowering', (name, before) => {
    const source = readFileSync(new URL(`../examples/${name}.matrix`, import.meta.url), 'utf8');
    const artifact = compile(source);
    expect(artifact.rows.length).toBeLessThan(before);
    expect(artifact.stats.instructions).toBeGreaterThan(0);
    // Program identifiers are not a key into a prebuilt matrix catalogue.
    const renamed = source.replace(/\bremainder\b/g, 'moduloWork').replace(/\bdivisor\b/g, 'candidateFactor').replace(/\bn\b/g, 'number');
    const other = compile(renamed);
    expect(other.rows).toEqual(artifact.rows);
    expect(other.initial).toEqual(artifact.initial);
    expect(other.stats.instructions).toBe(artifact.stats.instructions);
    if (name === 'prime-optimized') expect(artifact.stats.functionInstances.filter(fn => fn.endsWith('.remainder'))).toHaveLength(1);
  });
});
