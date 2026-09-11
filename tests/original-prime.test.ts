import { describe, expect, it } from 'vitest';
import { originalNames, originalPrime, trialDivisionPrime } from './fixtures/original-prime';

describe('original user-provided primality matrix oracle', () => {
  it('preserves the original 24 coordinates', () => {
    expect(originalNames).toHaveLength(24);
    expect(originalNames[22]).toBe('P');
    expect(originalNames[23]).toBe('Q');
  });
  it.each([
    [0, false, 2], [1, false, 2], [2, true, 4], [3, true, 30],
    [4, false, 22], [5, true, 120], [6, false, 34], [7, true, 260], [9, false, 118],
  ] as const)('n=%i returns %s in exactly %i updates', (n, prime, ticks) => {
    expect(originalPrime(n)).toEqual({ prime, ticks });
  });
  it('agrees with independent trial division and the proven bound for n=0..64', () => {
    for (let n = 0; n <= 64; n++) {
      const answer = originalPrime(n);
      expect(answer.prime, `n=${n}`).toBe(trialDivisionPrime(n));
      expect(answer.ticks).toBeLessThanOrEqual(8 * n * n + 4);
    }
  });
});
