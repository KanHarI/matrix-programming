import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { compile } from '../src/compiler';
import { optimizationDefinitions, resolveOptimizations, type OptimizationFlags, type OptimizationKey } from '../src/compiler-options';
import { MAX_U32, type CompileOptions } from '../src/core/types';
import { Machine, referenceBackend, type MatrixBackend } from '../src/runtime';
import { createWasmBackend } from '../src/wasm';

let backend: MatrixBackend;
beforeAll(async () => { backend = await createWasmBackend(Uint8Array.from(readFileSync('public/kernel.wasm'))); });
const allDisabled = Object.fromEntries(optimizationDefinitions.map(({ key }) => [key, false])) as OptimizationFlags;
interface ProgramCase {
  name: string;
  source: string;
  inputs: Record<string, number>;
  result: number;
  input?: string;
  output?: string;
  pixel?: boolean;
}
const cases: ProgramCase[] = [
  { name: 'parity', source: readFileSync(new URL('../examples/parity.matrix', import.meta.url), 'utf8'), inputs: { n: 5 }, result: 0 },
  { name: 'simple prime', source: readFileSync(new URL('../examples/prime-simple.matrix', import.meta.url), 'utf8'), inputs: { n: 5 }, result: 1 },
  { name: 'shared helpers', source: 'fn trim(x) { let value = x + 1; while (value > 2) { value = value - 1; } return value; } fn main(n) { return trim(n) + trim(0); }', inputs: { n: 4 }, result: 3 },
  { name: 'console and pixels', source: 'fn main() { print("Hi"); pixel(1, 2, 3, 4, 5); return 1; }', inputs: {}, result: 1, output: 'Hi', pixel: true },
  { name: 'console input', source: 'fn main() { let character = read(); putc(character); return character; }', inputs: {}, input: 'A', output: 'A', result: 65 },
  { name: 'parallel branches', source: 'fn count(n) { let left = n; while (left > 0) { left = left - 1; } return n; } fn main(n) { let (a, b) = parallel { count(n), count(2) }; return a + b; }', inputs: { n: 3 }, result: 5 },
  { name: 'bounded recursion', source: 'rec fn sum(n) { if (n == 0) { return 0; } return n + sum(n - 1); } fn main(n) { return sum(n); }', inputs: { n: 2 }, result: 3 },
];

function execute(program: ProgramCase, optimizations: Partial<OptimizationFlags>, selectedBackend = backend) {
  const artifact = compile(program.source, { optimizations, recursionDepth: 4 });
  const machine = new Machine(artifact, program.inputs, selectedBackend);
  if (program.input !== undefined) machine.enqueueInput(program.input);
  machine.runBatch(150_000);
  expect(machine.error, program.name).toBeNull();
  expect(machine.status, `${program.name}, tick ${machine.tick}`).toBe('ended');
  expect(machine.state[artifact.result!], program.name).toBe(program.result);
  expect(machine.consoleText, program.name).toBe(program.output ?? '');
  if (program.pixel) {
    expect(machine.events.filter(event => event.type === 'pixel')).toEqual([
      expect.objectContaining({ x: 1, y: 2, r: 3, g: 4, b: 5 }),
    ]);
    expect([...machine.pixels.slice((2 * 16 + 1) * 3, (2 * 16 + 1) * 3 + 3)]).toEqual([3, 4, 5]);
  }
  return machine;
}

describe('compiler optimization flag API', () => {
  it('resolves a fresh complete catalog of documented defaults', () => {
    const expected = Object.fromEntries(optimizationDefinitions.map(({ key, defaultEnabled }) => [key, defaultEnabled]));
    expect(resolveOptimizations()).toEqual(expected);
    expect(new Set(optimizationDefinitions.map(({ key }) => key)).size).toBe(optimizationDefinitions.length);
    expect(resolveOptimizations().loopSummaries).toBe(false);
    const changed = resolveOptimizations();
    changed.countdown = false;
    expect(resolveOptimizations().countdown).toBe(true);
  });

  it('keeps legacy summarizeLoops while giving the explicit optimization flag precedence', () => {
    expect(resolveOptimizations({ summarizeLoops: true }).loopSummaries).toBe(true);
    expect(resolveOptimizations({ summarizeLoops: false, optimizations: { loopSummaries: true } }).loopSummaries).toBe(true);
    expect(resolveOptimizations({ summarizeLoops: true, optimizations: { loopSummaries: false } }).loopSummaries).toBe(false);
    const source = 'fn main(n) { while (n > 0) { n = n - 1; } return n; }';
    expect(compile(source, { summarizeLoops: true }).rows)
      .toEqual(compile(source, { optimizations: { loopSummaries: true } }).rows);
    expect(compile(source, { summarizeLoops: true, optimizations: { loopSummaries: false } }).rows)
      .toEqual(compile(source, { summarizeLoops: false }).rows);
  });

  it('rejects unknown flag names before selecting any compiler backend', () => {
    const options = { optimizations: { imaginaryPass: true } } as unknown as CompileOptions;
    expect(() => resolveOptimizations(options)).toThrow(/Unknown compiler optimization 'imaginaryPass'/);
    expect(() => compile('fn main(n) { return n; }', options)).toThrow(/Unknown compiler optimization/);
  });

  it.each([0, 1, 'true', 'false', null, undefined, {}, []])('rejects non-boolean flag values: %j', value => {
    const options = { optimizations: { clockSampling: value } } as unknown as CompileOptions;
    expect(() => resolveOptimizations(options)).toThrow(/clockSampling.*must be a boolean/);
    expect(() => compile('fn main(n) { return n; }', options)).toThrow(/must be a boolean/);
  });

  it('validates the legacy option even when an explicit flag is also supplied', () => {
    expect(() => resolveOptimizations({ summarizeLoops: 1, optimizations: { loopSummaries: false } } as unknown as CompileOptions)).toThrow(/summarizeLoops must be a boolean/);
  });

  it.each([null, false, 0, 1, 'flags', []])('rejects a non-object optimization container: %j', optimizations => {
    expect(() => resolveOptimizations({ optimizations } as unknown as CompileOptions)).toThrow(/optimizations must be an object/);
  });
});

describe('optimization configurations preserve observable semantics', () => {
  it.each(optimizationDefinitions.map(({ key }) => key))('runs representative programs with %s disabled', key => {
    for (const program of cases) execute(program, { [key]: false });
    const parity = cases[0]!, prime = cases[1]!;
    for (const n of [0, 2, 6]) execute({ ...parity, name: `parity ${n}`, inputs: { n }, result: 1 }, { [key]: false });
    for (const [n, result] of [[0, 0], [1, 0], [2, 1], [4, 0], [9, 0]] as const) {
      execute({ ...prime, name: `simple prime ${n}`, inputs: { n }, result }, { [key]: false });
    }
  });

  it.each(cases.map(program => [program.name, program] as const))('runs %s with all optimizations disabled', (_name, program) => {
    execute(program, allDisabled);
  });

  it('keeps early and composite primality return paths correct with every flag disabled', () => {
    for (const n of [0, 1, 4, 9]) execute({ ...cases[1]!, inputs: { n }, result: 0 }, allDisabled);
  });

  it('runs deterministic mixed flag combinations', () => {
    let random = 0x39a175cd;
    for (let trial = 0; trial < 10; trial++) {
      const flags = Object.fromEntries(optimizationDefinitions.map(({ key }) => {
        random ^= random << 13; random ^= random >>> 17; random ^= random << 5;
        return [key, (random >>> 0) % 2 === 0];
      })) as OptimizationFlags;
      for (const program of cases) execute(program, flags);
    }
  }, 60_000);

  it('keeps the default source matrix unchanged when flags explicitly match defaults', () => {
    for (const program of cases) {
      const implicit = compile(program.source, { recursionDepth: 4 });
      const explicit = compile(program.source, { recursionDepth: 4, optimizations: resolveOptimizations() });
      expect(explicit.rows, program.name).toEqual(implicit.rows);
      expect(explicit.initial, program.name).toEqual(implicit.initial);
      expect(explicit.registers, program.name).toEqual(implicit.registers);
    }
  });
});

describe('clock and full-width gate optimization toggles', () => {
  const copySource = 'fn copy(n) { let value = n; let other = 1; other = value; return other; } fn main(n) { let copied = copy(n); if (copied == n) { return copied; } return 0; }';
  it.each(Array.from({ length: 8 }, (_, mask) => mask))('preserves u32 transfer with clock/gate combination %i', mask => {
    const flags: Partial<OptimizationFlags> = {
      counterMachine: false, countdown: false, straightLine: false,
      clockSampling: Boolean(mask & 1), sharedGateDelays: Boolean(mask & 2), boundedGates: Boolean(mask & 4),
      constantOperands: false, constantWrites: false,
    };
    for (const n of [0, 1, 2147483647, 2147483648, MAX_U32]) {
      execute({ name: `copy ${n}, mask ${mask}`, source: copySource, inputs: { n }, result: n }, flags);
    }
  });

  it('agrees between reference phase previews and WASM batching with delay-based clocks', () => {
    const program: ProgramCase = {
      name: 'delay-clock IO', source: 'fn main(n) { let c = read(); if (n == 4294967295) { putc(c); return 1; } return 0; }',
      inputs: { n: MAX_U32 }, input: 'Z', output: 'Z', result: 1,
    };
    const flags = { ...allDisabled, comparisonFusion: true, constantReturns: true };
    const batched = execute(program, flags);
    const stepped = new Machine(batched.artifact, program.inputs, referenceBackend);
    stepped.enqueueInput(program.input!);
    for (let phase = 0; phase < 30_000 && stepped.status === 'ready'; phase++) expect(stepped.stepPhase()).toBe(true);
    expect(stepped.error).toBeNull();
    expect(stepped.status).toBe('ended');
    expect([...stepped.state]).toEqual([...batched.state]);
    expect(stepped.tick).toBe(batched.tick);
    expect(stepped.events).toEqual(batched.events);
  });

  it.each(['clockSampling', 'boundedGates', 'sharedGateDelays'] as OptimizationKey[])('still faults on checked overflow when %s is disabled', key => {
    const source = 'fn add(n) { return n + 1; } fn main(n) { return add(n); }';
    const artifact = compile(source, { optimizations: { [key]: false } });
    const machine = new Machine(artifact, { n: MAX_U32 }, backend);
    machine.runBatch(10_000);
    expect(machine.status).toBe('fault');
    expect(machine.state[artifact.end]).toBe(0);
  });
});
