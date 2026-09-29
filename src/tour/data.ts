import { compile } from '../compiler';
import type { Artifact } from '../core/types';
import { examples } from '../examples';
import { stateChanges } from '../debugger';
import { Machine, referenceBackend } from '../runtime';

/** Every number the tour shows comes from compiling and running real source. */
export interface Update { tick: number; x: number[]; z: bigint[]; y: bigint[] }
export interface ParityRun { artifact: Artifact; updates: Update[]; final: number[] }

export const paritySource = examples.find(example => example.id === 'parity')!.source;
export const helloSource = examples.find(example => example.id === 'hello')!.source;
export const fibonacciSource = `fn main(n) {
  let a = 0;
  let b = 1;
  while (n > 0) {
    let t = a + b;
    a = b;
    b = t;
    n = n - 1;
  }
  return a;
}`;

let parityArtifact: Artifact | undefined;
export function parity(): Artifact { return parityArtifact ??= compile(paritySource); }

/** Each committed update of the parity matrix, with its signed sums and ReLU candidate. */
export function parityRun(n: number): ParityRun {
  const artifact = parity();
  const machine = new Machine(artifact, { n }, referenceBackend);
  const updates: Update[] = [];
  while (machine.status === 'ready' && updates.length < 64) {
    const x = [...machine.state];
    machine.stepPhase();
    const z = [...machine.raw!];
    machine.stepPhase();
    const y = [...machine.candidate!];
    machine.stepPhase();
    updates.push({ tick: machine.tick - 1, x, z, y });
  }
  return { artifact, updates, final: [...machine.state] };
}

export interface ProgramTick { tick: number; lines: number[]; marker: number; phase: number; values: Record<string, number> }
export interface ProgramRun { artifact: Artifact; ticks: ProgramTick[]; result: number }

/** Fibonacci through the general backend: program counter, 11-phase clock and variables per tick. */
export function fibonacciRun(n: number): ProgramRun {
  const artifact = compile(fibonacciSource);
  const machine = new Machine(artifact, { n }, referenceBackend);
  const clock = artifact.registers.map((register, index) => ({ register, index })).filter(({ register }) => /^clock\.\d+$/.test(register.name)).map(({ index }) => index);
  const variables = Object.fromEntries(['n', 'a', 'b', 't'].map(name => [name, artifact.registers.findIndex(register => register.name === `main.main.${name}`)]));
  const snapshot = (): ProgramTick => {
    const marker = artifact.markers.findIndex(item => machine.state[item.register] !== 0);
    return {
      tick: machine.tick,
      lines: [...new Set(artifact.markers.filter(item => machine.state[item.register] !== 0).map(item => item.line))],
      marker,
      phase: clock.findIndex(index => machine.state[index] !== 0),
      values: Object.fromEntries(Object.entries(variables).map(([name, index]) => [name, machine.state[index]!])),
    };
  };
  const ticks = [snapshot()];
  while (machine.status === 'ready' && ticks.length < 5000) { machine.step(); ticks.push(snapshot()); }
  return { artifact, ticks, result: machine.state[artifact.result!]! };
}

export interface ClockPhase { tick: number; phase: number; live: { index: number; name: string; value: number }[]; values: Record<string, number> }
export interface ClockWave { tick: number; phase: number; clock9: number; pc: number; dispatch: number; next: number }
export interface ClockTrace {
  artifact: Artifact;
  clock: number[];
  /** W restricted to the clock's rows and columns. */
  ring: number[][];
  /** The largest gate weight, read from the matrix itself. */
  gateWeight: number;
  line: number; text: string; pc: number; dispatch: number; nextPc: number; occurrence: number;
  /** One instruction period: phases 0–10 and the following phase 0, when it commits. */
  period: ClockPhase[];
  /** The period before, this one, and the one after, for the waveform. */
  wave: ClockWave[];
}

/**
 * The general backend's shared clock, observed while Fibonacci runs `let t = a + b;`.
 * A later loop iteration is used so that a, b and the old t are all nonzero.
 */
export function clockTrace(n = 5, occurrence = 3): ClockTrace {
  const artifact = compile(fibonacciSource);
  const machine = new Machine(artifact, { n }, referenceBackend);
  const names = artifact.registers.map(register => register.name);
  const clock = Array.from({ length: 11 }, (_, phase) => names.indexOf(`clock.${phase}`));
  const ring = clock.map(row => clock.map(column => {
    const { cols, weights } = artifact.rows[row]!;
    return cols.reduce((sum, col, index) => sum + (col === column ? weights[index]! : 0), 0);
  }));
  const lines = fibonacciSource.split('\n');
  const line = lines.findIndex(text => /let t = a \+ b/.test(text)) + 1;
  const pc = artifact.markers.find(marker => marker.line === line)!.register;
  const readsFrom = (row: number, column: number) => artifact.rows[row]!.cols.includes(column);
  const dispatch = names.findIndex((name, index) => name.endsWith('.dispatch') && readsFrom(index, pc));
  const nextPc = artifact.markers.find(marker => marker.register !== pc && readsFrom(marker.register, dispatch))!.register;
  const gateRow = names.findIndex(name => name.endsWith('.high1'));
  const one = names.indexOf('constant.1');
  const gateWeight = -artifact.rows[gateRow]!.weights[artifact.rows[gateRow]!.cols.indexOf(one)]!;
  const variables = Object.fromEntries(['a', 'b', 't', 'n'].map(name => [name, names.indexOf(`main.main.${name}`)]));
  const markerRegisters = new Set(artifact.markers.map(marker => marker.register));
  const phaseOf = () => clock.findIndex(index => machine.state[index] !== 0);
  const snapshot = (): ClockPhase => ({
    tick: machine.tick,
    phase: phaseOf(),
    live: names.flatMap((name, index) => {
      const value = machine.state[index]!;
      // Circuit coordinates only: not the clock, constants, variables, comparators or other lines' counters.
      if (!value || /^clock\.|^constant\.|^main\.main\.|compare\./.test(name) || (markerRegisters.has(index) && index !== pc && index !== nextPc)) return [];
      return [{ index, name, value }];
    }),
    values: Object.fromEntries(Object.entries(variables).map(([name, index]) => [name, machine.state[index]!])),
  });
  const wave: ClockWave[] = [];
  const record = () => wave.push({ tick: machine.tick, phase: phaseOf(), clock9: machine.state[clock[9]!]!, pc: machine.state[pc]!, dispatch: machine.state[dispatch]!, next: machine.state[nextPc]! });
  // Find the start (phase 0) of the requested execution of the line.
  let seen = 0;
  while (machine.status === 'ready' && machine.tick < 5000) {
    if (machine.state[pc] !== 0 && phaseOf() === 0 && ++seen === occurrence) break;
    record(); if (wave.length > 11) wave.shift();
    machine.step();
  }
  const period: ClockPhase[] = [];
  for (let step = 0; step < 12; step++) { period.push(snapshot()); record(); if (step < 11) machine.step(); }
  for (let step = 0; step < 10; step++) { machine.step(); record(); }
  return { artifact, clock, ring, gateWeight, line, text: lines[line - 1]!.trim(), pc, dispatch, nextPc, occurrence, period, wave };
}

/** What each parity commit changed, as the lab's Recent snapshots list it. */
export function parityHistory(n = 4): { tick: number; changes: string[] }[] {
  const run = parityRun(n);
  const states = [...run.updates.map(update => update.x), run.final];
  return states.slice(1).map((state, index) => ({
    tick: index + 1,
    changes: stateChanges(states[index]!, state).map(change => `${shortName(run.artifact, change.index)} ${change.from}→${change.to}`),
  }));
}

export const overflowSource = `fn main(n) {
  let total = 4294967295;
  while (n > 0) {
    total = total + n;
    n = 0;
  }
  return total;
}`;
export interface FaultDemo { error: string; register: string; line: number; label: string; terms: { name: string; weight: number; value: number }[]; sum: bigint; bound: number }
/** A real overflow: the machine stops instead of wrapping, and names the entry and line. */
export function overflowFault(n = 2): FaultDemo {
  const artifact = compile(overflowSource);
  const machine = new Machine(artifact, { n }, referenceBackend);
  machine.runBatch(10_000);
  const register = machine.faultRegister!;
  const marker = artifact.markers.find(item => machine.state[item.register] !== 0)!;
  const row = artifact.rows[register]!;
  return {
    error: machine.error!, register: artifact.registers[register]!.name, line: marker.line, label: marker.label,
    terms: row.cols.map((column, index) => ({ name: artifact.registers[column]!.name, weight: row.weights[index]!, value: machine.state[column]! })),
    sum: machine.raw![register]!, bound: artifact.registers[register]!.bound,
  };
}

export type OutputEvent = { tick: number; kind: 'char'; text: string } | { tick: number; kind: 'pixel'; x: number; y: number; color: string };
let helloEvents: OutputEvent[] | undefined;
/** Console characters and pixels emitted by the Hello preset, in commit order. */
export function helloOutput(): OutputEvent[] {
  if (helloEvents) return helloEvents;
  const machine = new Machine(compile(helloSource), {}, referenceBackend);
  machine.runBatch(100_000);
  return helloEvents = machine.events.map(event => event.type === 'console'
    ? { tick: event.tick, kind: 'char', text: String.fromCodePoint(event.codepoint) }
    : { tick: event.tick, kind: 'pixel', x: event.x, y: event.y, color: `rgb(${event.r} ${event.g} ${event.b})` });
}

/** A short, readable name for a compiled coordinate. */
export function shortName(artifact: Artifact, index: number): string {
  const register = artifact.registers[index]!;
  if (register.kind === 'constant') return `const_${register.name.split('.').pop()}`;
  const last = register.name.split('.').pop()!;
  return ({ belowStrideMinusOne: 'below_1', belowStride: 'below_2' } as Record<string, string>)[last] ?? last;
}
