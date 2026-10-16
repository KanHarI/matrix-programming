import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';
import { compile } from '../src/compiler';
import { MAX_U32 } from '../src/core/types';
import { Machine, createWasmBackend, referenceBackend, type MatrixBackend } from '../src/runtime';

let wasm: MatrixBackend;
beforeAll(async () => { wasm = await createWasmBackend(await readFile(new URL('../public/kernel.wasm', import.meta.url))); });
function execute(source: string, inputs: Record<string, number> = {}, backend: MatrixBackend = wasm, budget = 100_000) {
  const machine = new Machine(compile(source), inputs, backend);
  machine.runBatch(budget);
  return machine;
}
function result(machine: Machine): number {
  expect(machine.error).toBeNull();
  expect(machine.status).toBe('ended');
  return machine.state[machine.artifact.result!]!;
}

describe('compiled primitives execute exclusively as matrix updates', () => {
  it.each([0, 1, 2147483647, 2147483648, MAX_U32])('copies the complete u32 range: %i', value => {
    const source = 'fn main(n) { let x = n; let y = 1; y = x; return y; }';
    const native = execute(source, { n: value });
    expect(result(native)).toBe(value);
    const reference = execute(source, { n: value }, referenceBackend);
    expect(result(reference)).toBe(value);
    expect(Array.from(native.state)).toEqual(Array.from(reference.state));
    expect(native.tick).toBe(reference.tick);
  });

  it('performs saturating subtraction, including full-range operands', () => {
    expect(result(execute('fn main() { return 0 - 4294967295; }'))).toBe(0);
    expect(result(execute('fn main() { return 4294967295 - 1; }'))).toBe(MAX_U32 - 1);
    expect(result(execute('fn main() { return 4294967295 - 4294967295; }'))).toBe(0);
  });

  it('checks positive arithmetic overflow with no wrapped result', () => {
    for (const backend of [referenceBackend, wasm]) {
      const machine = execute('fn main(n) { return n + 1; }', { n: MAX_U32 }, backend);
      expect(machine.status).toBe('fault');
      expect(machine.error).toContain('bound');
      expect(machine.state[machine.artifact.end]).toBe(0);
    }
  });

  it.each(['==', '!=', '<', '<=', '>', '>='])('branches correctly on %s at numeric boundaries', op => {
    const source = `fn main(a, b) { if (a ${op} b) { return 17; } else { return 29; } }`;
    const relations: Record<string, (a: number, b: number) => boolean> = {
      '==': (a, b) => a === b, '!=': (a, b) => a !== b, '<': (a, b) => a < b,
      '<=': (a, b) => a <= b, '>': (a, b) => a > b, '>=': (a, b) => a >= b,
    };
    for (const a of [0, 1, MAX_U32]) for (const b of [0, 1, MAX_U32]) {
      expect(result(execute(source, { a, b }))).toBe(relations[op]!(a, b) ? 17 : 29);
    }
  });

  it('does not execute arithmetic in an inactive branch', () => {
    expect(result(execute('fn main(n) { if (0) { return n + n; } return n; }', { n: MAX_U32 }))).toBe(MAX_U32);
  });

  it.each(['==', '!=', '<', '<=', '>', '>='])('comparison %s expressions return canonical 0/1 values', op => {
    const source = `fn main(a, b) { return a ${op} b; }`;
    const relations: Record<string, (a: number, b: number) => boolean> = {
      '==': (a, b) => a === b, '!=': (a, b) => a !== b, '<': (a, b) => a < b,
      '<=': (a, b) => a <= b, '>': (a, b) => a > b, '>=': (a, b) => a >= b,
    };
    for (const [a, b] of [[0, MAX_U32], [MAX_U32, 0], [MAX_U32, MAX_U32]]) {
      expect(result(execute(source, { a: a!, b: b! }))).toBe(Number(relations[op]!(a!, b!)));
    }
  });

  it('holds data and updates while-loop control correctly', () => {
    expect(result(execute('fn main(n) { let count = 0; while (n > 0) { n = n - 1; count = count + 1; } return count; }', { n: 10 }))).toBe(10);
  });

  it('reuses one helper matrix body from two sequential calling sites', () => {
    const source = 'fn addOne(x) { return x + 1; } fn main(n) { let a = addOne(n); let b = addOne(a); return b; }';
    const machine = execute(source, { n: 40 });
    expect(result(machine)).toBe(42);
    expect(machine.artifact.stats.functionInstances.filter(name => name.endsWith('.addOne'))).toHaveLength(1);
  });

  it('shares a helper body across nested acyclic calls and repeated loop calls', () => {
    const source = 'fn inc(x) { return x + 1; } fn twice(x) { return inc(inc(x)); } fn main() { let n = 0; while (n < 10) { n = twice(n); } return n; }';
    expect(result(execute(source))).toBe(10);
  });

  it('rejects direct and indirect recursion, including unused recursive declarations', () => {
    expect(() => compile('fn main() { return main(); }')).toThrow();
    expect(() => compile('fn a() { return b(); } fn b() { return a(); } fn main() { return 0; }')).toThrow('Recursion');
    expect(result(execute('rec fn a() { return 1; } fn main() { return a(); }'))).toBe(1);
  });

  it('links only used devices and toggling LED does not resize W', () => {
    const source = 'fn main(n) { return n; }';
    const enabled = compile(source);
    const disabled = compile(source, { devices: { consoleOutput: false, consoleInput: false, screen: false, led: false } });
    expect(enabled.devices).toEqual({});
    expect(disabled.devices).toEqual({});
    expect(disabled.rows).toEqual(enabled.rows);
    expect(disabled.registers).toEqual(enabled.registers);
    expect(disabled.led).toBeUndefined();
    expect(enabled.led).toBe(enabled.result);
    expect(() => compile('fn main() { print("Hi"); return 0; }', { devices: { consoleOutput: false } })).toThrow('disabled');
  });

  it('faults for dynamic out-of-bounds fixed array accesses', () => {
    const machine = execute('fn main(n) { let values[2]; values[n] = 7; return values[0]; }', { n: 2 });
    expect(machine.status).toBe('fault');
    expect(machine.error).toContain('index is outside');
    expect(() => compile('fn main() { let values[2]; return values[2]; }')).toThrow('Array index');
  });

  it('writes and reads a dynamically indexed fixed-array coordinate', () => {
    expect(result(execute('fn main(n) { let values[3]; values[n] = 4294967295; return values[n]; }', { n: 1 }))).toBe(MAX_U32);
  });

  it('runs parallel contexts simultaneously and joins without terminating early', () => {
    const source = 'fn count(n) { let x = 0; while (x < n) { x = x + 1; } return x; } fn main() { let (a, b) = parallel { count(2), count(5) }; return a + b; }';
    const machine = new Machine(compile(source), {}, wasm);
    let overlapping = false;
    for (let i = 0; i < 100_000 && machine.status === 'ready'; i++) {
      const activeContexts = new Set(machine.artifact.markers.filter(marker => machine.state[marker.register] && marker.context !== 'main').map(marker => marker.context));
      if (activeContexts.size === 2) overlapping = true;
      machine.step();
    }
    expect(result(machine)).toBe(7);
    expect(overlapping).toBe(true);
    expect(machine.artifact.stats.contexts).toBe(3);
    expect(machine.artifact.stats.functionInstances.filter(name => name.endsWith('.count'))).toHaveLength(2);
  });

  it('rejects direct and transitive I/O within parallel computational branches', () => {
    expect(() => compile('fn effect() { print("X"); return 0; } fn helper() { return effect(); } fn main() { let (a, b) = parallel { helper(), helper() }; return a; }')).toThrow('pure');
  });

  it('can repeat a parallel fork in a loop without reusing stale done flags', () => {
    const source = 'fn plus(x) { return x + 1; } fn main() { let x = 0; while (x < 6) { let (a, b) = parallel { plus(x), plus(x) }; x = a + 1; } return x; }';
    expect(result(execute(source))).toBe(6);
  });

  it('supports nested finite parallel contexts', () => {
    const source = 'fn plus(x) { return x + 1; } fn pair(x) { let (a, b) = parallel { plus(x), plus(x) }; return a + b; } fn main() { let (a, b) = parallel { pair(2), pair(3) }; return a + b; }';
    const machine = execute(source);
    expect(result(machine)).toBe(14);
    expect(machine.artifact.stats.contexts).toBe(7);
  });

  it('captures scalar input before the external latch clears, including NUL and EOF', () => {
    for (const input of ['\0', '😀', null]) {
      const machine = new Machine(compile('fn main() { let c = read(); return c; }'), {}, wasm);
      machine.runBatch(1000);
      expect(machine.status).toBe('waiting');
      const stoppedAt = machine.tick;
      expect(machine.runBatch(1000)).toBe(0);
      expect(machine.tick).toBe(stoppedAt);
      if (input === null) machine.closeInput(); else machine.enqueueInput(input);
      machine.runBatch(1000);
      expect(result(machine)).toBe(input === null ? MAX_U32 : input.codePointAt(0)!);
    }
  });

  it('reads back each channel of a written pixel, in both backends', () => {
    // Weighted so a swapped or missing channel changes the sum.
    const source = 'fn main(x) { let before = readpixel(x, 15, 2); pixel(x, 15, 7, 255, 31); return before + readpixel(x, 15, 0) + readpixel(x, 15, 1) + readpixel(x, 15, 1) + readpixel(x, 15, 2) + readpixel(x, 15, 2) + readpixel(x, 15, 2); }';
    for (const backend of [wasm, referenceBackend]) {
      expect(result(execute(source, { x: 15 }, backend))).toBe(7 + 2 * 255 + 3 * 31);
    }
    // Pixel memory survives across loop iterations: a running total kept only on the screen.
    const counter = 'fn main(n) { while (n > 0) { pixel(0, 0, readpixel(0, 0, 0) + 1, 0, 0); n = n - 1; } return readpixel(0, 0, 0); }';
    expect(result(execute(counter, { n: 5 }))).toBe(5);
    // A dynamic channel selects among the three delivered values.
    const dynamic = 'fn main(c) { pixel(2, 3, 10, 20, 30); return readpixel(2, 3, c); }';
    for (const c of [0, 1, 2]) expect(result(execute(dynamic, { c }))).toBe([10, 20, 30][c]!);
  });

  it('reads all three channels with one request into variables or array elements', () => {
    const triplet = `fn main(i) {
      pixel(9, 1, 11, 22, 33);
      let r; let g; let b;
      readpixel(9, 1, r, g, b);
      let rgb[4];
      readpixel(9, 1, rgb[i], rgb[i + 1], rgb[0]);
      return r + g + g + b + b + b + rgb[0] + rgb[1] + rgb[2] + rgb[2];
    }`;
    for (const backend of [wasm, referenceBackend]) {
      // rgb = [33, 11, 22, 0] for i = 1.
      expect(result(execute(triplet, { i: 1 }, backend))).toBe(11 + 2 * 22 + 3 * 33 + 33 + 11 + 2 * 22);
    }
    const one = compile('fn main() { let r; let g; let b; readpixel(0, 0, r, g, b); return r + g + b; }');
    const three = compile('fn main() { return readpixel(0, 0, 0) + readpixel(0, 0, 1) + readpixel(0, 0, 2); }');
    expect(one.markers.filter(marker => marker.label === 'request pixel')).toHaveLength(1);
    expect(three.markers.filter(marker => marker.label === 'request pixel')).toHaveLength(3);
    expect(one.stats.instructions).toBeLessThan(three.stats.instructions);
  });

  it('links pixel reads as part of the screen device, sharing its address ports', () => {
    const readOnly = compile('fn main() { return readpixel(3, 4, 1); }');
    expect(readOnly.devices.screen).toBeUndefined();
    expect(Object.keys(readOnly.devices.screenRead!)).toEqual(['x', 'y', 'request', 'r', 'g', 'b']);
    expect(readOnly.registers[readOnly.devices.screenRead!.g]!.name).toBe('screen.latch.g');
    expect(readOnly.registers.filter(register => register.name.startsWith('screen.read.')).map(register => register.name)).toEqual(['screen.read.r', 'screen.read.g', 'screen.read.b']);
    expect(result(execute('fn main() { return readpixel(3, 4, 1); }'))).toBe(0);
    expect(() => compile('fn main() { return readpixel(0, 0, 0); }', { devices: { screen: false } })).toThrow('The screen device is disabled');
    expect(() => compile('fn main() { return readpixel(0, 0); }')).toThrow('readpixel expects 3 arguments (x, y, channel) or 5 (x, y, r, g, b)');
    expect(() => compile('fn main() { return readpixel(0, 0, 3); }')).toThrow('readpixel channel outside 0..2');
    expect(() => compile('fn main() { readpixel(0, 0, 1, 2, 3); return 0; }')).toThrow('stores into variables or array elements');
    expect(() => compile('fn f() { return 0; } fn main() { let a[2]; let g; let b; readpixel(0, 0, a[f()], g, b); return 0; }')).toThrow('targets cannot contain calls');
    expect(() => compile('fn peek() { return readpixel(0, 0, 0); } fn main() { let (a, b) = parallel { peek(), peek() }; return a; }')).toThrow('pure');
    expect(() => compile('fn readpixel() { return 0; } fn main() { return 0; }')).toThrow('reserved');
  });

  it('faults on a pixel read outside the screen before the request commits, or on a dynamic channel above 2', () => {
    for (const [x, y] of [[16, 0], [0, 16]]) {
      const machine = execute('fn main(x, y) { return readpixel(x, y, 0); }', { x, y });
      expect(machine.status).toBe('fault');
      expect(machine.error).toBe('Pixel read is outside the 16×16 display bounds');
      expect(machine.faultRegister).toBe(machine.artifact.devices.screenRead!.request);
      expect(machine.state[machine.artifact.devices.screenRead!.request]).toBe(0);
    }
    const channel = execute('fn main(c) { return readpixel(0, 0, c); }', { c: 3 });
    expect(channel.status).toBe('fault');
    expect(channel.error).toBe('Line 1: readpixel channel is outside 0..2');
  });
});
