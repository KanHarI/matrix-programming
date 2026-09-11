import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';
import { MAX_U32, type Artifact, type SparseRow } from '../src/core/types';
import { Machine, createWasmBackend, referenceBackend, type MatrixBackend } from '../src/runtime';

function artifact(initial: number[], rows: SparseRow[], end = initial.length - 1): Artifact {
  return {
    version: 1, name: 'fixture', source: '', initial, rows, end,
    registers: initial.map((_, i) => ({ name: `r${i}`, kind: 'data', bound: MAX_U32 })),
    inputs: {}, devices: {}, markers: [], stats: { instructions: 0, contexts: 1, functionInstances: [] },
  };
}
const row = (cols: number[] = [], weights = cols.map(() => 1)): SparseRow => ({ cols, weights });
let wasm: MatrixBackend;
beforeAll(async () => { wasm = await createWasmBackend(await readFile(new URL('../public/kernel.wasm', import.meta.url))); });

describe('exact, atomic matrix execution', () => {
  it('shows raw negatives, then ReLU, then commits without preview effects', () => {
    const machine = new Machine(artifact([3, 1, 0], [row([0, 1], [1, -5]), row([1]), row()]));
    expect(machine.stepPhase()).toBe(true);
    expect(machine.phase).toBe('multiplied');
    expect(machine.raw?.[0]).toBe(-2n);
    expect(machine.tick).toBe(0);
    expect(machine.state[0]).toBe(3);
    machine.stepPhase();
    expect(machine.candidate?.[0]).toBe(0n);
    expect(machine.state[0]).toBe(3);
    machine.stepPhase();
    expect(machine.tick).toBe(1);
    expect(machine.state[0]).toBe(0);
  });

  it('preserves overflow in previews and faults atomically at commit', () => {
    for (const backend of [referenceBackend, wasm]) {
      const machine = new Machine(artifact([MAX_U32, 1, 0], [row([0, 1]), row([1]), row()]), {}, backend);
      machine.stepPhase(); machine.stepPhase();
      expect(machine.candidate?.[0]).toBe(4294967296n);
      expect(machine.stepPhase()).toBe(false);
      expect(machine.status).toBe('fault');
      expect(machine.state[0]).toBe(MAX_U32);
      expect(machine.tick).toBe(0);
    }
  });

  it('WASM widens unsigned state and signed coefficients before multiplication', () => {
    const a = artifact([MAX_U32, MAX_U32, 0], [row([0, 1], [1073741824, -1073741823]), row([0], [-2147483648]), row()]);
    const reference = new Machine(a);
    const native = new Machine(a, {}, wasm);
    reference.stepPhase(); native.stepPhase();
    expect(Array.from(native.raw!)).toEqual(Array.from(reference.raw!));
    expect(native.raw?.[0]).toBe(BigInt(MAX_U32));
    expect(native.raw?.[1]).toBe(-2147483648n * BigInt(MAX_U32));
    reference.step(); native.step();
    expect(Array.from(native.state)).toEqual([MAX_U32, 0, 0]);
    expect(Array.from(native.state)).toEqual(Array.from(reference.state));
  });

  it('rejects uncertified signed i64 sums, malformed weights, and invalid inputs', () => {
    expect(() => new Machine(artifact([MAX_U32, 0], [row([0, 0], [2147483647, 2147483647]), row()]))).toThrow('certified');
    expect(() => new Machine(artifact([0], [row([0], [2147483648])]))).toThrow('signed 32-bit');
    const a = artifact([0, 0], [row([0]), row()]); a.inputs = { n: 0 };
    for (const n of [-1, 1.5, MAX_U32 + 1, Number.NaN, Number.POSITIVE_INFINITY]) expect(() => new Machine(a, { n })).toThrow('Input n');
    expect(() => new Machine(a, { unknown: 1 })).toThrow('Unknown input');
  });

  it('enforces declared control bounds in both backends', () => {
    const a = artifact([1, 0], [row([0], [2]), row()]);
    a.registers[0]!.bound = 1;
    for (const backend of [referenceBackend, wasm]) {
      const machine = new Machine(a, {}, backend);
      expect(machine.step()).toBe(false);
      expect(machine.error).toContain('bound');
      expect(machine.state[0]).toBe(1);
    }
  });

  it('initial end terminates immediately without producing output', () => {
    const a = artifact([65, 1, 1], [row([0]), row([1]), row([2])]);
    a.devices.consoleOutput = { codepoint: 0, emit: 1 };
    const machine = new Machine(a);
    expect(machine.status).toBe('ended');
    expect(machine.step()).toBe(false);
    expect(machine.consoleText).toBe('');
  });

  it('compiler fault gates prevent the entire candidate commit', () => {
    const a = artifact([1, 0, 0], [row([0]), row([0]), row()]);
    a.faults = [{ register: 1, message: 'Buffer capacity exceeded' }];
    const machine = new Machine(a, {}, wasm);
    expect(machine.step()).toBe(false);
    expect(machine.error).toBe('Buffer capacity exceeded');
    expect(machine.state[1]).toBe(0);
    expect(machine.tick).toBe(0);
  });

  it('supports independent machines sharing a WASM backend during a preview', () => {
    const first = new Machine(artifact([7, 0], [row([0]), row()]), {}, wasm);
    const second = new Machine(artifact([9, 2, 0], [row([0, 1]), row([1]), row()]), {}, wasm);
    first.stepPhase(); second.step(); first.step();
    expect(first.state[0]).toBe(7);
    expect(second.state[0]).toBe(11);
  });
});

describe('optional device ports', () => {
  it('emits on every tick including consecutive nonzero flags and the final tick', () => {
    const a = artifact([65, 1, 0], [row([0]), row([1]), row()]);
    a.devices.consoleOutput = { codepoint: 0, emit: 1 };
    const machine = new Machine(a, {}, wasm);
    machine.runBatch(3);
    expect(machine.consoleText).toBe('AAA');
    expect(machine.events.map(event => event.tick)).toEqual([1, 2, 3]);
    const final = artifact([65, 1, 0], [row([0]), row([1]), row([1])]);
    final.devices.consoleOutput = a.devices.consoleOutput;
    const ended = new Machine(final);
    expect(ended.runBatch(10)).toBe(1);
    expect(ended.consoleText).toBe('A');
    expect(ended.status).toBe('ended');
  });

  it('rejects invalid output atomically, before console, pixels, or end effects', () => {
    const a = artifact([0xd800, 1, 0], [row([0]), row([1]), row([1])]);
    a.devices.consoleOutput = { codepoint: 0, emit: 1 };
    const machine = new Machine(a);
    expect(machine.step()).toBe(false);
    expect(machine.tick).toBe(0);
    expect(machine.events).toHaveLength(0);
    expect(machine.consoleText).toBe('');
    expect(machine.status).toBe('fault');
  });

  it('controls one RGB pixel using exactly six screen coordinates', () => {
    const a = artifact([3, 4, 20, 30, 40, 1, 0], [row([0]), row([1]), row([2]), row([3]), row([4]), row([5]), row([5])]);
    a.devices.screen = { x: 0, y: 1, r: 2, g: 3, b: 4, emit: 5 };
    const machine = new Machine(a);
    machine.stepPhase(); machine.stepPhase();
    expect(machine.pixels.every(x => x === 0)).toBe(true);
    machine.stepPhase();
    expect(Array.from(machine.pixels.slice((4 * 16 + 3) * 3, (4 * 16 + 3) * 3 + 3))).toEqual([20, 30, 40]);
    expect(machine.events).toHaveLength(1);
    const invalid = structuredClone(a); invalid.initial[0] = 16;
    const bad = new Machine(invalid);
    expect(bad.step()).toBe(false);
    expect(bad.pixels.every(x => x === 0)).toBe(true);
  });

  function reader(): Artifact {
    // request, available, eof, scalar, output scalar, output emit, end
    const a = artifact([1, 0, 0, 0, 0, 0, 0], [row(), row(), row(), row(), row([3]), row([1]), row([5])]);
    a.devices.consoleInput = { request: 0, available: 1, eof: 2, codepoint: 3 };
    a.devices.consoleOutput = { codepoint: 4, emit: 5 };
    return a;
  }

  it('waits without advancing, reserves only during previews, and consumes one scalar at commit', () => {
    const machine = new Machine(reader(), {}, wasm);
    expect(machine.step()).toBe(false);
    expect(machine.status).toBe('waiting');
    expect(machine.tick).toBe(0);
    machine.enqueueInput('😀Z');
    machine.stepPhase();
    expect(machine.raw?.[3]).toBe(0x1f600n);
    expect(machine.pendingInput).toBe(2);
    machine.stepPhase();
    expect(machine.pendingInput).toBe(2);
    machine.stepPhase();
    expect(machine.pendingInput).toBe(1);
    machine.runBatch(10);
    expect(machine.consoleText).toBe('😀');
    expect(machine.pendingInput).toBe(1);
  });

  it('distinguishes NUL from EOF and delivers EOF only after queued characters', () => {
    const nul = new Machine(reader()); nul.enqueueInput('\0'); nul.closeInput(); nul.step();
    expect(Array.from(nul.state.slice(1, 4))).toEqual([1, 0, 0]);
    const eof = new Machine(reader()); eof.closeInput(); eof.step();
    expect(Array.from(eof.state.slice(1, 4))).toEqual([1, 1, 0]);
    expect(() => eof.enqueueInput('A')).toThrow('closed');
  });

  it('does not consume reserved input on failed commit and reset discards previews', () => {
    const a = reader(); a.registers[3]!.bound = 1;
    const machine = new Machine(a); machine.enqueueInput('A');
    machine.stepPhase(); machine.stepPhase(); expect(machine.stepPhase()).toBe(false);
    expect(machine.pendingInput).toBe(1);
    expect(machine.tick).toBe(0);
    machine.reset();
    expect(machine.raw).toBeNull(); expect(machine.pendingInput).toBe(0); expect(machine.phase).toBe('ready');
  });

  it('end beats a pending read and LED is a metadata-only binding', () => {
    const a = reader(); a.initial[6] = 1; a.led = 0;
    const machine = new Machine(a);
    expect(machine.led).toBe(true);
    expect(machine.step()).toBe(false);
    expect(machine.status).toBe('ended');
    expect(machine.state.length).toBe(7);
  });

  it('requires zero W rows for the external input latches', () => {
    const a = reader(); a.rows[1] = row([1]);
    expect(() => new Machine(a)).toThrow('Input latch rows');
  });
});

describe('the original primality matrix', () => {
  function original(n: number): Artifact {
    const names = 'n d t r I S C U V i s c u v a b p e f g h k P Q end'.split(' ');
    const rows: Record<string, Record<string, number>> = {
      n: { n: 1 }, d: { d: 1, i: 2, a: 2, b: -2, k: 1 },
      t: { t: 1, c: 1, e: -1, f: -1, g: 1, v: -1 },
      r: { r: 1, c: 1, e: -1, f: -1, g: 1, u: -1, v: -1 },
      I: {}, S: { i: 1, a: 1, b: -1, k: 1 },
      C: { s: 1, p: -1, c: 1, e: -1, f: -1, g: 1, h: 1 },
      U: { u: 1, h: -1, f: 1, g: -1 }, V: { v: 1, k: -1, e: 1, g: -1 },
      i: { I: 1 }, s: { S: 1 }, c: { C: 1 }, u: { U: 1 }, v: { V: 1 },
      a: { I: 1, n: -1 }, b: { I: 2, n: -1 }, p: { S: 1, d: 1, n: -1 },
      e: { C: 1, t: 1, n: -1 }, f: { C: 1, r: 1, d: -1 },
      g: { C: 1, t: 1, r: 1, n: -1, d: -1 }, h: { U: 1, r: -1 },
      k: { V: 1, t: -1, r: -1 }, P: { P: 1, p: 1 },
      Q: { Q: 1, b: 1, a: -1, g: 1 }, end: { P: 1, Q: 1 },
    };
    const a = artifact(names.map(name => name === 'n' ? n : name === 'I' ? 1 : 0), names.map(name => {
      const entries = Object.entries(rows[name]!);
      return row(entries.map(([src]) => names.indexOf(src)), entries.map(([, weight]) => weight));
    }));
    a.registers.forEach((r, i) => { r.name = names[i]!; });
    a.result = 22;
    return a;
  }

  it.each([0, 1, 2, 3, 4, 5, 6, 7, 9, 11, 13, 15, 17, 19, 25, 29, 31])('matches trial division for n=%i in both exact backends', n => {
    let expected = n >= 2;
    for (let d = 2; d * d <= n; d++) if (n % d === 0) expected = false;
    const a = original(n);
    const reference = new Machine(a);
    const native = new Machine(a, {}, wasm);
    // Added end coordinate observes P + Q one tick after the original 24-state stop.
    reference.runBatch(8 * n * n + 5);
    native.runBatch(8 * n * n + 5);
    expect(reference.status).toBe('ended');
    expect(native.status).toBe('ended');
    expect(Boolean(native.state[22])).toBe(expected);
    expect(Array.from(native.state)).toEqual(Array.from(reference.state));
    expect(native.tick).toBe(reference.tick);
  });
});
