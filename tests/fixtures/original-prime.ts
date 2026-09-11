/** The user's original 24-coordinate recurrence, kept independent of the compiler. */
export const originalNames = 'n d t r I S C U V i s c u v a b p e f g h k P Q'.split(' ');
const originalRows: Record<string, Record<string, number>> = {
  n: { n: 1 },
  d: { d: 1, i: 2, a: 2, b: -2, k: 1 },
  t: { t: 1, c: 1, e: -1, f: -1, g: 1, v: -1 },
  r: { r: 1, c: 1, e: -1, f: -1, g: 1, u: -1, v: -1 },
  I: {},
  S: { i: 1, a: 1, b: -1, k: 1 },
  C: { s: 1, p: -1, c: 1, e: -1, f: -1, g: 1, h: 1 },
  U: { u: 1, h: -1, f: 1, g: -1 },
  V: { v: 1, k: -1, e: 1, g: -1 },
  i: { I: 1 }, s: { S: 1 }, c: { C: 1 }, u: { U: 1 }, v: { V: 1 },
  a: { I: 1, n: -1 }, b: { I: 2, n: -1 },
  p: { S: 1, d: 1, n: -1 }, e: { C: 1, t: 1, n: -1 },
  f: { C: 1, r: 1, d: -1 }, g: { C: 1, t: 1, r: 1, n: -1, d: -1 },
  h: { U: 1, r: -1 }, k: { V: 1, t: -1, r: -1 },
  P: { P: 1, p: 1 }, Q: { Q: 1, b: 1, a: -1, g: 1 },
};
const sparse = originalNames.map(name => Object.entries(originalRows[name]!).map(([column, weight]) => [originalNames.indexOf(column), weight] as const));

export function originalPrime(n: number): { prime: boolean; ticks: number } {
  if (!Number.isInteger(n) || n < 0 || n > 1000) throw new Error('Original oracle is limited to integer inputs 0..1000');
  let state = originalNames.map(() => 0);
  state[0] = n;
  state[4] = 1;
  for (let ticks = 1; ticks < 8 * n * n + 5; ticks++) {
    state = sparse.map(row => Math.max(0, row.reduce((sum, [column, weight]) => sum + state[column]! * weight, 0)));
    if (state[22]! + state[23]! === 1) return { prime: Boolean(state[22]), ticks };
  }
  throw new Error('Original matrix exceeded its proven bound');
}

export function trialDivisionPrime(n: number): boolean {
  if (n < 2) return false;
  for (let divisor = 2; divisor * divisor <= n; divisor++) if (n % divisor === 0) return false;
  return true;
}
