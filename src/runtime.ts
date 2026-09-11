import { MAX_U32, type Artifact } from './core/types';

export interface MatrixBackend {
  readonly name: string;
  multiply(artifact: Artifact, state: Uint32Array): BigInt64Array;
  rectify?(artifact: Artifact, raw: BigInt64Array): { next: Uint32Array; invalid: number };
}
export type Phase = 'ready' | 'multiplied' | 'rectified';
export type Status = 'ready' | 'waiting' | 'ended' | 'fault';
export type DeviceEvent =
  | { tick: number; type: 'console'; codepoint: number }
  | { tick: number; type: 'pixel'; x: number; y: number; r: number; g: number; b: number };
const I64_MAX = (1n << 63n) - 1n;
const validScalar = (n: number) => n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff);
const uint = (n: number) => Number.isInteger(n) && n >= 0 && n <= MAX_U32;

export const referenceBackend: MatrixBackend = {
  name: 'Exact JavaScript / BigInt',
  multiply(artifact, state) {
    const raw = new BigInt64Array(state.length);
    artifact.rows.forEach((row, i) => {
      let sum = 0n;
      for (let j = 0; j < row.cols.length; j++) {
        sum += BigInt(row.weights[j]!) * BigInt(state[row.cols[j]!]!);
      }
      raw[i] = sum;
    });
    return raw;
  },
};

/** Reject malformed matrices before either backend can perform unsafe arithmetic. */
export function validateArtifact(a: Artifact): void {
  const n = a.registers.length;
  if (!n || a.rows.length !== n || a.initial.length !== n) throw new Error('Matrix dimensions do not match');
  const index = (i: number) => {
    if (!Number.isInteger(i) || i < 0 || i >= n) throw new Error(`Invalid register index: ${i}`);
  };
  a.registers.forEach((r, i) => {
    if (!uint(r.bound)) throw new Error(`Invalid register bound: ${r.name}`);
    if (!uint(a.initial[i]!) || a.initial[i]! > r.bound) throw new Error(`Invalid initial value: ${r.name}`);
  });
  a.rows.forEach((row, i) => {
    if (row.cols.length !== row.weights.length) throw new Error(`Malformed sparse row ${i}`);
    let bound = 0n;
    row.cols.forEach((c, j) => {
      index(c);
      const w = row.weights[j]!;
      if (!Number.isInteger(w) || w < -2147483648 || w > 2147483647) throw new Error(`Weight outside signed 32-bit range in row ${i}`);
      bound += BigInt(Math.abs(w)) * BigInt(a.registers[c]!.bound);
    });
    if (bound > I64_MAX) throw new Error(`Row ${i} cannot be certified for exact signed 64-bit accumulation`);
  });
  index(a.end);
  if (a.result !== undefined) index(a.result);
  if (a.led !== undefined) index(a.led);
  a.faults?.forEach(fault => index(fault.register));
  Object.values(a.inputs).forEach(index);
  Object.values(a.devices).forEach(device => Object.values(device).forEach(i => index(i as number)));
  const input = a.devices.consoleInput;
  if (input) {
    if (new Set(Object.values(input)).size !== 4) throw new Error('Console input ports must be distinct');
    for (const i of [input.available, input.eof, input.codepoint]) {
      if (a.rows[i]!.weights.some(w => w !== 0)) throw new Error('Input latch rows must be zero in W');
    }
  }
}

/** All machine arithmetic is the fixed sparse matrix; the host only handles ports. */
export class Machine {
  state!: Uint32Array;
  raw: BigInt64Array | null = null;
  candidate: bigint[] | null = null;
  phase: Phase = 'ready';
  status: Status = 'ready';
  tick = 0;
  error: string | null = null;
  consoleText = '';
  pixels = new Uint8Array(16 * 16 * 3);
  events: DeviceEvent[] = [];
  private queue: number[] = [];
  private closed = false;
  private reserved: { available: number; eof: number; codepoint: number } | null = null;
  private inputValues: Record<string, number>;

  constructor(public readonly artifact: Artifact, inputs: Record<string, number> = {}, public readonly backend: MatrixBackend = referenceBackend) {
    validateArtifact(artifact);
    this.inputValues = { ...inputs };
    this.reset(inputs);
  }

  get led(): boolean { return this.artifact.led !== undefined && this.state[this.artifact.led]! > 0; }
  get pendingInput(): number { return this.queue.length; }

  reset(inputs: Record<string, number> = this.inputValues): void {
    const state = Uint32Array.from(this.artifact.initial);
    for (const [name, value] of Object.entries(inputs)) {
      const i = this.artifact.inputs[name];
      if (i === undefined) throw new Error(`Unknown input: ${name}`);
      if (!uint(value) || value > this.artifact.registers[i]!.bound) throw new Error(`Input ${name} must be an integer from 0 to ${this.artifact.registers[i]!.bound}`);
      state[i] = value;
    }
    this.inputValues = { ...inputs };
    this.state = state;
    this.raw = null;
    this.candidate = null;
    this.phase = 'ready';
    this.status = state[this.artifact.end] ? 'ended' : 'ready';
    this.tick = 0;
    this.error = null;
    this.consoleText = '';
    this.pixels.fill(0);
    this.events = [];
    this.queue = [];
    this.closed = false;
    this.reserved = null;
  }

  enqueueInput(text: string): void {
    if (this.closed) throw new Error('The console input stream is closed');
    const scalars = Array.from(text, char => char.codePointAt(0)!);
    if (scalars.some(n => !validScalar(n))) throw new Error('Console input must contain valid Unicode scalar values');
    // Avoid the engine's argument-count limit for large pasted input.
    for (const scalar of scalars) this.queue.push(scalar);
    if (this.status === 'waiting') this.status = 'ready';
  }

  closeInput(): void {
    this.closed = true;
    if (this.status === 'waiting') this.status = 'ready';
  }

  private fail(message: string): false {
    this.status = 'fault';
    this.error = message;
    return false;
  }

  private multiply(): boolean {
    const port = this.artifact.devices.consoleInput;
    this.reserved = null;
    if (port && this.state[port.request]! > 0) {
      if (this.queue.length) this.reserved = { available: 1, eof: 0, codepoint: this.queue[0]! };
      else if (this.closed) this.reserved = { available: 1, eof: 1, codepoint: 0 };
      else { this.status = 'waiting'; return false; }
    }
    this.raw = this.backend.multiply(this.artifact, this.state);
    if (port && this.reserved) {
      this.raw[port.available] = BigInt(this.reserved.available);
      this.raw[port.eof] = BigInt(this.reserved.eof);
      this.raw[port.codepoint] = BigInt(this.reserved.codepoint);
    }
    this.status = 'ready';
    this.phase = 'multiplied';
    return true;
  }

  private commit(fast = false): boolean {
    let next: Uint32Array;
    if (fast && this.backend.rectify) {
      const result = this.backend.rectify(this.artifact, this.raw!);
      if (result.invalid >= 0) return this.fail(`Register ${this.artifact.registers[result.invalid]!.name} exceeds its ${this.artifact.registers[result.invalid]!.bound} bound`);
      next = result.next;
    } else {
      next = new Uint32Array(this.state.length);
      for (let i = 0; i < next.length; i++) {
        const value = this.candidate?.[i] ?? (this.raw![i]! < 0n ? 0n : this.raw![i]!);
        if (value > BigInt(this.artifact.registers[i]!.bound)) return this.fail(`Register ${this.artifact.registers[i]!.name} exceeds its ${this.artifact.registers[i]!.bound} bound (${value})`);
        next[i] = Number(value);
      }
    }
    const fault = this.artifact.faults?.find(fault => next[fault.register]! > 0);
    if (fault) return this.fail(fault.message);
    const output = this.artifact.devices.consoleOutput;
    if (output && next[output.emit] && !validScalar(next[output.codepoint]!)) return this.fail('Console output is not a valid Unicode scalar value');
    const screen = this.artifact.devices.screen;
    if (screen && next[screen.emit]) {
      if (next[screen.x]! > 15 || next[screen.y]! > 15 || [screen.r, screen.g, screen.b].some(i => next[i]! > 255)) return this.fail('Pixel output is outside the 16×16 RGB display bounds');
    }
    this.state = next;
    this.tick++;
    if (this.reserved && !this.reserved.eof) this.queue.shift();
    this.reserved = null;
    if (output && next[output.emit]) {
      const codepoint = next[output.codepoint]!;
      this.consoleText += String.fromCodePoint(codepoint);
      this.events.push({ tick: this.tick, type: 'console', codepoint });
    }
    if (screen && next[screen.emit]) {
      const [x, y, r, g, b] = [screen.x, screen.y, screen.r, screen.g, screen.b].map(i => next[i]!) as [number, number, number, number, number];
      this.pixels.set([r, g, b], (y * 16 + x) * 3);
      this.events.push({ tick: this.tick, type: 'pixel', x, y, r, g, b });
    }
    if (this.events.length > 512) this.events.splice(0, this.events.length - 512);
    this.raw = null;
    this.candidate = null;
    this.phase = 'ready';
    this.status = next[this.artifact.end] ? 'ended' : 'ready';
    return true;
  }

  stepPhase(): boolean {
    if (this.status === 'ended' || this.status === 'fault') return false;
    if (this.phase === 'ready') return this.multiply();
    if (this.phase === 'multiplied') {
      this.candidate = Array.from(this.raw!, x => x < 0n ? 0n : x);
      this.phase = 'rectified';
      return true;
    }
    return this.commit();
  }

  step(): boolean {
    if (this.status === 'ended' || this.status === 'fault') return false;
    if (this.phase === 'ready' && !this.multiply()) return false;
    return this.commit(true);
  }

  runBatch(maxSteps: number): number {
    if (!Number.isSafeInteger(maxSteps) || maxSteps < 0) throw new Error('Step budget must be a nonnegative safe integer');
    const initial = this.tick;
    for (let i = 0; i < maxSteps && this.step(); i++) { /* Every commit observes all device events. */ }
    return this.tick - initial;
  }
}

export { createWasmBackend } from './wasm';
