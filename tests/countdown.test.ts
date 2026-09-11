import { describe, expect, it } from 'vitest';
import { parse } from '../src/parser';
import { compileCountdown } from '../src/countdown';
import { Machine } from '../src/runtime';
import type { CompileOptions } from '../src/core/types';

function source(stride: number, comparison = '==') {
  return `fn main(number) { let left = number; while (left >= ${stride}) { left = left - ${stride}; } return left ${comparison} 0; }`;
}
function fused(text: string, options: CompileOptions = {}) {
  const artifact = compileCountdown(parse(text), text, options);
  expect(artifact).toBeDefined();
  return artifact!;
}

describe('generic constant-stride countdown fusion', () => {
  it('emits exactly six coordinates and no unused language or I/O infrastructure for stride two', () => {
    const artifact = fused(source(2));
    expect(artifact.rows).toHaveLength(6);
    expect(artifact.rows).toEqual([
      { cols: [0, 5], weights: [1, -2] },
      { cols: [5, 0], weights: [1, -1] },
      { cols: [5, 0], weights: [2, -1] },
      { cols: [1], weights: [1] },
      { cols: [2, 1], weights: [1, -1] },
      { cols: [5], weights: [1] },
    ]);
    expect(artifact.stats.instructions).toBe(0);
    expect(artifact.registers.map(r => r.name).join(' ')).not.toMatch(/clock|returnAddress|stack|console|screen|\.pc\./);
    expect(artifact.devices).toEqual({});
  });

  it.each([2, 3, 4, 7, 31])('implements divisibility and non-divisibility for generic stride %i', stride => {
    for (const comparison of ['==', '!=']) {
      const artifact = fused(source(stride, comparison));
      expect(artifact.rows).toHaveLength(stride === 2 ? 6 : 7);
      for (let n = 0; n <= 100; n++) {
        const machine = new Machine(artifact, { number: n });
        machine.runBatch(100);
        expect(machine.error).toBeNull();
        expect(machine.status).toBe('ended');
        expect(machine.tick).toBe(Math.floor(n / stride) + 2);
        expect(machine.state[artifact.result!], `n=${n}, stride=${stride}, op=${comparison}`).toBe(Number(comparison === '==' ? n % stride === 0 : n % stride !== 0));
      }
    }
  });

  it('supports arbitrary identifiers and direct mutation of the input parameter', () => {
    const text = 'fn main(bananas) { while (bananas >= 2) { bananas = bananas - 2; } return bananas != 0; }';
    const artifact = fused(text);
    expect(artifact.inputs).toEqual({ bananas: 0 });
    const machine = new Machine(artifact, { bananas: 11 });
    machine.runBatch(20);
    expect(machine.state[artifact.result!]).toBe(1);
    expect(machine.tick).toBe(7);
  });

  it('keeps all inputs runtime-variable, including full-u32 state and maximum signed coefficients', () => {
    const artifact = fused(source(2147483647));
    for (const n of [0, 2147483646, 2147483647, 2147483648, 4294967294, 4294967295]) {
      const machine = new Machine(artifact, { number: n });
      machine.runBatch(10);
      expect(machine.error).toBeNull();
      expect(machine.status).toBe('ended');
      expect(machine.state[artifact.result!]).toBe(Number(n % 2147483647 === 0));
    }
  });

  it('observing or disabling an unused device never changes the six-coordinate matrix', () => {
    const enabled = fused(source(2));
    const disabled = fused(source(2), { devices: { led: false, consoleInput: false, consoleOutput: false, screen: false } });
    expect(disabled.rows).toEqual(enabled.rows);
    expect(disabled.registers).toEqual(enabled.registers);
    expect(disabled.led).toBeUndefined();
  });

  it.each([
    'fn main(n) { while (n >= 2) { n = n - 1; } return n == 0; }',
    'fn main(n) { while (n > 2) { n = n - 2; } return n == 0; }',
    'fn main(n) { while (n >= 2) { n = n - 2; putc(65); } return n == 0; }',
    'fn main(n) { while (n >= 2) { n = n - 2; } return n == 1; }',
    'fn main(n) { let n = n; while (n >= 2) { n = n - 2; } return n == 0; }',
    'fn main(n, other) { while (n >= 2) { n = n - 2; } return n == 0; }',
    'fn main(n) { while (n >= 1) { n = n - 1; } return n == 0; }',
    'fn main(n) { while (n >= 2147483648) { n = n - 2147483648; } return n == 0; }',
    'fn main(n) { let remainder = 10; while (remainder >= 2) { remainder = remainder - 2; } return remainder == 0; }',
  ])('declines source outside the proven pattern: %s', text => {
    expect(compileCountdown(parse(text), text, {})).toBeUndefined();
  });
});
