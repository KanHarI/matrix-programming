import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { compile } from '../src/compiler';
import { Machine, type MatrixBackend } from '../src/runtime';
import { createWasmBackend } from '../src/wasm';

let backend: MatrixBackend;
beforeAll(async () => {
  const bytes = Uint8Array.from(readFileSync(new URL('../public/kernel.wasm', import.meta.url)));
  backend = await createWasmBackend(bytes);
});
function execute(source: string, inputs: Record<string, number> = {}, budget = 100_000) {
  const artifact = compile(source);
  const machine = new Machine(artifact, inputs, backend);
  machine.runBatch(budget);
  expect(machine.error).toBeNull();
  expect(machine.status, `tick budget ${budget} exhausted`).toBe('ended');
  return { artifact, machine, result: machine.state[artifact.result!]! };
}

describe('shared regular function circuitry', () => {
  it('reuses one helper body from two sequential call sites', () => {
    const { artifact, result } = execute(`
      fn increment(n) { return n + 1; }
      fn main(n) {
        let first = increment(n);
        let second = increment(first);
        return first + second;
      }
    `, { n: 9 });
    expect(result).toBe(21);
    expect(artifact.stats.functionInstances.filter(name => name.endsWith('.increment'))).toEqual(['main.increment']);
    // Calls enter the shared body directly; no no-op function header is emitted.
    expect(artifact.markers.filter(marker => marker.label === 'enter increment')).toHaveLength(0);
    expect(artifact.markers.filter(marker => marker.label === 'call increment')).toHaveLength(2);
  });

  it('reuses return-address gates safely on repeated calls in a loop', () => {
    const { result } = execute(`
      fn increment(n) { let local = n + 1; return local; }
      fn main() {
        let total = 0;
        let index = 0;
        while (index < 12) {
          total = increment(total);
          index = index + 1;
        }
        return total;
      }
    `);
    expect(result).toBe(12);
  });

  it('keeps values alive across nested calls and acyclic helper calls', () => {
    const { result, artifact } = execute(`
      fn increment(n) { return n + 1; }
      fn twice(n) { return increment(n) + increment(n); }
      fn main() { return twice(increment(4)); }
    `);
    expect(result).toBe(12);
    expect(artifact.stats.functionInstances.filter(name => name.endsWith('.increment'))).toHaveLength(1);
  });

  it.each([
    'fn f(n) { return f(n); } fn main() { return f(1); }',
    'fn f(n) { return g(n); } fn g(n) { return f(n); } fn main() { return f(1); }',
    'fn unused(n) { return unused(n); } fn main() { return 1; }',
  ])('rejects direct, indirect, and unused recursion: %s', source => {
    expect(() => compile(source)).toThrow(/recursion/i);
  });

  it('explicitly rejects rec fn until bounded stacks are implemented', () => {
    expect(() => compile('rec fn f(n) { return f(n); } fn main() { return f(1); }')).toThrow(/bounded recursive stacks/i);
  });
});

describe('structured parallel computations', () => {
  const countdown = `fn countdown(n) {
    let remaining = n;
    while (remaining > 0) { remaining = remaining - 1; }
    return n;
  }`;

  it('starts both branches together and holds the completed branch until the join', () => {
    const artifact = compile(`${countdown}
      fn main() {
        let (short, long) = parallel { countdown(1), countdown(7) };
        return short + long;
      }
    `);
    expect(artifact.stats.contexts).toBe(3);
    const branchContexts = [...new Set(artifact.markers.map(m => m.context))].filter(name => name !== 'main');
    expect(branchContexts).toHaveLength(2);
    const [shortContext, longContext] = branchContexts as [string, string];
    const shortDone = artifact.registers.findIndex(r => r.name === `${shortContext}.done`);
    const shortResult = artifact.registers.findIndex(r => r.name === `${shortContext}.countdown.result`);
    const longDone = artifact.registers.findIndex(r => r.name === `${longContext}.done`);
    const machine = new Machine(artifact, {}, backend);
    const startedAt = new Map<string, number>();
    let observedOverlap = false;
    let observedEarlyFinish = false;
    for (let step = 0; step < 20_000 && machine.status !== 'ended'; step++) {
      expect(machine.step(), machine.error ?? 'unexpected pause').toBe(true);
      const active = new Set(artifact.markers.filter(m => machine.state[m.register]).map(m => m.context));
      for (const context of branchContexts) if (active.has(context) && !startedAt.has(context)) startedAt.set(context, machine.tick);
      if (active.has(shortContext) && active.has(longContext)) observedOverlap = true;
      if (machine.state[shortDone] && !machine.state[longDone]) {
        observedEarlyFinish = true;
        expect(machine.status).toBe('ready');
        expect(machine.state[artifact.end]).toBe(0);
        expect(machine.state[shortResult]).toBe(1);
        expect(active.has(shortContext)).toBe(false);
      }
    }
    expect(machine.status).toBe('ended');
    expect(startedAt.get(shortContext)).toBe(startedAt.get(longContext));
    expect(observedOverlap).toBe(true);
    expect(observedEarlyFinish).toBe(true);
    expect(machine.state[artifact.result!]).toBe(8);
  });

  it('allocates distinct function instances for simultaneous calls', () => {
    const { artifact, result } = execute(`${countdown}
      fn main() {
        let (a, b) = parallel { countdown(2), countdown(5) };
        return a + b;
      }
    `);
    const instances = artifact.stats.functionInstances.filter(name => name.endsWith('.countdown'));
    expect(instances).toHaveLength(2);
    expect(new Set(instances).size).toBe(2);
    expect(result).toBe(7);
  });

  it('transfers the complete unsigned 32-bit range through concurrent contexts', () => {
    const { result } = execute(`
      fn identity(n) { return n; }
      fn main() {
        let (a, b) = parallel { identity(4294967295), identity(4294967294) };
        return a - b;
      }
    `);
    expect(result).toBe(1);
  });

  it('resets done flags when the same fork executes repeatedly', () => {
    const { artifact, result } = execute(`${countdown}
      fn main() {
        let count = 0;
        let total = 0;
        while (count < 4) {
          let (a, b) = parallel { countdown(count), countdown(count + 1) };
          total = total + a + b;
          count = count + 1;
        }
        return total;
      }
    `);
    expect(artifact.stats.contexts).toBe(3);
    expect(result).toBe(16);
  });

  it('joins finite nested forks without stopping their sibling computation', () => {
    const { artifact, result } = execute(`${countdown}
      fn pair(n) {
        let (a, b) = parallel { countdown(n), countdown(n + 1) };
        return a + b;
      }
      fn main() {
        let (a, b) = parallel { pair(2), countdown(8) };
        return a + b;
      }
    `);
    expect(artifact.stats.contexts).toBe(5);
    expect(result).toBe(13);
  });

  it.each(['print("x")', 'putc(65)', 'pixel(0, 0, 1, 2, 3)', 'read()', 'halt()'])('rejects the effect %s inside a parallel branch', effect => {
    expect(() => compile(`
      fn effect() { ${effect}; return 1; }
      fn pure() { return 2; }
      fn main() { let (a, b) = parallel { effect(), pure() }; return a + b; }
    `)).toThrow(/pure|parallel/i);
  });

  it('checks effects transitively through regular helper calls', () => {
    expect(() => compile(`
      fn emit() { putc(65); return 1; }
      fn indirect() { return emit(); }
      fn main() { let (a, b) = parallel { indirect(), indirect() }; return a + b; }
    `)).toThrow(/pure|parallel/i);
  });

  it('requires one result binding per branch and function-call branches', () => {
    expect(() => compile('fn f() { return 1; } fn main() { let (a) = parallel { f(), f() }; return a; }')).toThrow(/branch count/i);
    expect(() => compile('fn main() { let (a, b) = parallel { 1, 2 }; return a; }')).toThrow(/call a regular pure function/i);
  });
});
