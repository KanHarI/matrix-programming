import { describe, expect, it } from 'vitest';
import { clockTrace, fibonacciRun, helloOutput, parity, parityRun, shortName } from '../src/tour/data';

// The tour narrates these facts; they must stay true of the real compiler and runtime.
describe('guided tour data', () => {
  it('parity is six named entries whose updates decide evenness', () => {
    const artifact = parity();
    expect(artifact.rows).toHaveLength(6);
    expect(artifact.registers.map((_, index) => shortName(artifact, index))).toEqual(['remaining', 'below_1', 'below_2', 'result', 'end', 'const_1']);
    const even = parityRun(4);
    expect(even.updates).toHaveLength(4);
    expect(even.updates[0]!.x).toEqual([4, 0, 0, 0, 0, 1]);
    expect(even.updates[0]!.z).toEqual([2n, -3n, -2n, 0n, 0n, 1n]);
    expect(even.updates[0]!.y).toEqual([2n, 0n, 0n, 0n, 0n, 1n]);
    expect(even.final[artifact.end]).toBe(1);
    expect(even.final[artifact.led!]).toBe(1);
    const odd = parityRun(7);
    expect(odd.final[artifact.led!]).toBe(0);
    expect(odd.updates).toHaveLength(Math.floor(7 / 2) + 2);
  });

  it('Fibonacci moves one program counter through an 11-phase clock', () => {
    const run = fibonacciRun(5);
    expect(run.result).toBe(5);
    for (const frame of run.ticks.filter(item => item.marker >= 0)) expect(frame.lines).toHaveLength(1);
    const clocked = run.ticks.filter(item => item.phase >= 0);
    expect(new Set(clocked.map(item => item.phase)).size).toBe(11);
    // A simple statement holds its line for one full clock cycle.
    expect(run.ticks.filter(item => item.lines[0] === 2)).toHaveLength(11);
    expect(run.ticks.at(-1)!.values).toMatchObject({ n: 0, a: 5, b: 8 });
  });

  it('the clock side tour shows the compiled ring, phase schedule and gate weight', () => {
    const trace = clockTrace();
    // A cyclic permutation: clock k copies clock k − 1, and clock 0 copies clock 10.
    trace.ring.forEach((row, k) => expect(row).toEqual(row.map((_, column) => Number(column === (k + 10) % 11))));
    expect(trace.gateWeight).toBe(2_147_483_647);
    expect(trace.text).toBe('let t = a + b;');
    expect(trace.period.map(phase => phase.phase)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 0]);
    const at = (phase: number, pattern: RegExp) => trace.period[phase]!.live.filter(entry => pattern.test(entry.name)).map(entry => entry.value);
    const { a, b, t } = trace.period[0]!.values;
    expect([a, b, t]).toEqual([1, 2, 2]);
    expect(at(2, /\.read\.[ab]\.\d+$/)).toEqual([1, 1]);
    expect(at(5, /\.read\.[ab]\.\d+\.value$/)).toEqual([a, b]);
    expect(at(6, /\.operand\.[ab]$/)).toEqual([a, b]);
    expect(at(7, /\.alu$/)).toEqual([a! + b!]);
    expect(at(10, /dispatch$/)).toEqual([1]);
    expect(at(10, /\.write\.\d+\.(old|new)\.value$/).sort()).toEqual([t, a! + b!].sort());
    expect(trace.period[11]!.values.t).toBe(a! + b!);
    expect(trace.period[11]!.live.map(entry => entry.index)).toEqual([trace.nextPc]);
    // The waveform: dispatch fires once per instruction, in the update after clock 9.
    const fired = trace.wave.filter(sample => sample.dispatch);
    expect(fired).toHaveLength(1);
    expect(fired[0]!.phase).toBe(10);
  });

  it('Hello prints its greeting and draws the H one pixel event at a time', () => {
    const events = helloOutput();
    expect(events.filter(event => event.kind === 'char').map(event => event.kind === 'char' ? event.text : '').join('')).toBe('Hello, world!\n');
    expect(events.filter(event => event.kind === 'pixel')).toHaveLength(26);
    expect(events.map(event => event.tick)).toEqual([...events.map(event => event.tick)].sort((a, b) => a - b));
  });
});
