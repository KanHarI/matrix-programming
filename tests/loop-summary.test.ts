import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Program } from '../src/core/ast';
import { compile } from '../src/compiler';
import { summarizeLoops } from '../src/loop-summary';
import { parse } from '../src/parser';
import { Machine, type MatrixBackend } from '../src/runtime';
import { createWasmBackend } from '../src/wasm';
import { trialDivisionPrime } from './fixtures/original-prime';

let backend: MatrixBackend;
beforeAll(async () => { backend = await createWasmBackend(Uint8Array.from(readFileSync('public/kernel.wasm'))); });
function execute(source: string, inputs: Record<string, number>, enabled: boolean) {
  const artifact = compile(source, { summarizeLoops: enabled });
  const machine = new Machine(artifact, inputs, backend);
  machine.runBatch(100_000);
  return { artifact, machine, result: machine.state[artifact.result!]! };
}
const remainingWhiles = (program: Program) => JSON.stringify(program).match(/"kind":"while"/g)?.length ?? 0;

describe('optional pure countdown-loop summarization', () => {
  it('rewrites a unit countdown into an assignment of zero and preserves location metadata', () => {
    const program = parse('fn main(x) {\n while (x > 0) {\n x = x - 1;\n }\n return x;\n}');
    const rewritten = summarizeLoops(program);
    expect(rewritten.functions[0]!.body[0]).toEqual({
      kind: 'assign', target: { kind: 'variable', name: 'x', line: 3 },
      value: { kind: 'number', value: 0, line: 3 }, line: 3,
    });
  });

  it('updates multiple other words using the old counter regardless of body order', () => {
    const program = parse('fn main(x, y, z) { while (x != 0) { x = x - 1; z = z - 1; y = y - 1; } return x; }');
    const body = summarizeLoops(program).functions[0]!.body;
    expect(body[0]).toMatchObject({ kind: 'assign', target: { name: 'z' }, value: { op: '-', left: { name: 'z' }, right: { name: 'x' } } });
    expect(body[1]).toMatchObject({ kind: 'assign', target: { name: 'y' }, value: { op: '-', left: { name: 'y' }, right: { name: 'x' } } });
    expect(body[2]).toMatchObject({ kind: 'assign', target: { name: 'x' }, value: { value: 0 } });
  });

  it('does not mutate the original AST, including nested functions and blocks', () => {
    const program = parse('fn helper(x) { if (x > 0) { while (x > 0) { x = x - 1; } } return x; } fn main(x) { return helper(x); }');
    const original = structuredClone(program);
    function freeze(value: unknown): void {
      if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(freeze); }
    }
    freeze(program);
    const rewritten = summarizeLoops(program);
    expect(program).toEqual(original);
    expect(rewritten).not.toBe(program);
    expect(remainingWhiles(rewritten)).toBe(0);
    expect(remainingWhiles(program)).toBe(1);
  });

  it('traverses nested bodies without treating an outer control-containing loop as decrement-only', () => {
    const program = parse('fn main(x, y) { while (y > 0) { while (x > 0) { x = x - 1; } y = y - 1; } return x; }');
    const rewritten = summarizeLoops(program);
    expect(remainingWhiles(rewritten)).toBe(1);
    expect(rewritten.functions[0]!.body[0]).toMatchObject({ kind: 'while', body: [
      { kind: 'assign', value: { value: 0 } }, { kind: 'assign', target: { name: 'y' } },
    ] });
  });

  it.each([
    'while (x >= 0) { x = x - 1; }',
    'while (x > 1) { x = x - 1; }',
    'while (x == 0) { x = x - 1; }',
    'while (x > 0) { x = x - 2; }',
    'while (x > 0) { x = x - 1; x = x - 1; }',
    'while (x > 0) { y = y - 1; }',
    'while (x > 0) { x = x - 1; y = x - 1; }',
    'while (x > 0) { x = x - 1; y = y + 1; }',
    'while (x > 0) { x = x - 1; putc(65); }',
    'while (x > 0) { x = x - 1; let y = 0; }',
    'while (x > 0) { x = x - 1; values[0] = values[0] - 1; }',
  ])('leaves an unproven loop unchanged: %s', loop => {
    const program = parse(`fn main(x, y) { ${loop} return x; }`);
    expect(summarizeLoops(program)).toEqual(program);
  });

  it('is opt-in and preserves the original source in the compiled artifact', () => {
    const source = 'fn main(x) { while (x > 0) { x = x - 1; } return x; }';
    const normal = execute(source, { x: 9 }, false);
    const summarized = execute(source, { x: 9 }, true);
    expect(normal.machine.status).toBe('ended');
    expect(summarized.machine.status).toBe('ended');
    expect(normal.result).toBe(0);
    expect(summarized.result).toBe(0);
    expect(summarized.machine.tick).toBeLessThan(normal.machine.tick);
    expect(summarized.artifact.source).toBe(source);
    expect(compile(source).rows).toEqual(normal.artifact.rows);
  });

  it('matches baseline execution when other words are smaller, equal, or larger than the counter', () => {
    const source = 'fn main(x, y, z) { while (x != 0) { x = x - 1; z = z - 1; y = y - 1; } return y + z; }';
    for (const x of [0, 1, 4, 9]) for (const y of [0, 1, 4, 10]) for (const z of [0, 3, 9]) {
      const normal = execute(source, { x, y, z }, false);
      const summarized = execute(source, { x, y, z }, true);
      expect(normal.machine.error).toBeNull();
      expect(summarized.machine.error).toBeNull();
      expect(summarized.machine.status).toBe('ended');
      expect(summarized.result).toBe(normal.result);
      expect(summarized.result).toBe(Math.max(0, y - x) + Math.max(0, z - x));
    }
  });

  it('summarizes full-u32 countdowns without arithmetic wraparound', () => {
    const source = 'fn main(x, y) { while (x > 0) { x = x - 1; y = y - 1; } return y; }';
    for (const [x, y] of [[4294967295, 4294967295], [4294967294, 4294967295], [4294967295, 0]]) {
      const { machine, result } = execute(source, { x: x!, y: y! }, true);
      expect(machine.error).toBeNull();
      expect(machine.status).toBe('ended');
      expect(result).toBe(Math.max(0, y! - x!));
    }
  });

  it('does not eliminate overflow outside a summarized loop', () => {
    const source = 'fn main(x) { while (x > 0) { x = x - 1; } return 4294967295 + 1; }';
    for (const enabled of [false, true]) {
      const { artifact, machine } = execute(source, { x: 3 }, enabled);
      expect(machine.status).toBe('fault');
      expect(machine.state[artifact.end]).toBe(0);
    }
  });

  it('retains observable loop output rather than summarizing a loop with I/O', () => {
    const source = 'fn main(x) { while (x > 0) { x = x - 1; putc(65); } return x; }';
    const { machine, result } = execute(source, { x: 3 }, true);
    expect(machine.status).toBe('ended');
    expect(machine.consoleText).toBe('AAA');
    expect(result).toBe(0);
  });

  it('matches baseline simple primality for inputs 0..32 without assuming a smaller matrix', () => {
    const source = readFileSync(new URL('../examples/prime-simple.matrix', import.meta.url), 'utf8');
    const baseline = compile(source);
    const summarized = compile(source, { summarizeLoops: true });
    const clocked = compile(source, { optimizations: { counterMachine: false } });
    let baselineTicks = 0;
    let summarizedTicks = 0;
    let clockedTicks = 0;
    for (let n = 0; n <= 32; n++) {
      const normal = new Machine(baseline, { n }, backend);
      const fast = new Machine(summarized, { n }, backend);
      const beforeCounterLowering = new Machine(clocked, { n }, backend);
      normal.runBatch(1_000_000);
      fast.runBatch(1_000_000);
      beforeCounterLowering.runBatch(1_000_000);
      expect(beforeCounterLowering.status).toBe('ended');
      expect(normal.error).toBeNull();
      expect(fast.error).toBeNull();
      expect(normal.status, `baseline n=${n}`).toBe('ended');
      expect(fast.status, `summarized n=${n}`).toBe('ended');
      expect(fast.state[summarized.result!]).toBe(normal.state[baseline.result!]);
      expect(fast.state[summarized.result!]).toBe(Number(trialDivisionPrime(n)));
      baselineTicks += normal.tick;
      summarizedTicks += fast.tick;
      clockedTicks += beforeCounterLowering.tick;
    }
    // Summaries still accelerate the shared-ALU lowering. But the unsummarized
    // counter program now qualifies for a much faster clock-free backend.
    expect(summarizedTicks).toBeLessThan(clockedTicks);
    expect(baselineTicks).toBeLessThan(summarizedTicks);
    expect(summarized.source).toBe(source);
  }, 60_000);

  it('preserves console and pixel output before and after a summarized loop', () => {
    const source = `fn main(x, y) {
      print("before:");
      pixel(1, 2, 3, 4, 5);
      while (x > 0) { x = x - 1; y = y - 1; }
      putc(65 + y);
      pixel(2, 3, y, 8, 9);
      print(":after");
      return y;
    }`;
    for (const [x, y] of [[0, 4], [5, 8], [8, 3]]) {
      const baseline = execute(source, { x: x!, y: y! }, false);
      const summarized = execute(source, { x: x!, y: y! }, true);
      expect(baseline.machine.status).toBe('ended');
      expect(summarized.machine.status).toBe('ended');
      expect(summarized.machine.error).toBeNull();
      expect(summarized.result).toBe(baseline.result);
      expect(summarized.machine.consoleText).toBe(`before:${String.fromCodePoint(65 + Math.max(0, y! - x!))}:after`);
      expect(summarized.machine.consoleText).toBe(baseline.machine.consoleText);
      expect([...summarized.machine.pixels]).toEqual([...baseline.machine.pixels]);
      // Algebraic summarization intentionally changes update counts, not the
      // ordering or payloads of the observable device events.
      expect(summarized.machine.events.map(({ tick: _tick, ...event }) => event))
        .toEqual(baseline.machine.events.map(({ tick: _tick, ...event }) => event));
    }
  });

  it.each([
    ['fn main() { while (missing > 0) { missing = missing - 1; } return 0; }', /Unknown variable/],
    ['fn main(x) { while (x > 0) { x = x - 1; missing = missing - 1; } return 0; }', /Unknown variable/],
    ['fn main() { let values[2]; while (values > 0) { values = values - 1; } return 0; }', /Array.*index/],
    ['fn main(x) { let values[2]; while (x > 0) { x = x - 1; values = values - 1; } return 0; }', /Array.*index/],
    ['fn main(x) { let x = 0; while (x > 0) { x = x - 1; } return 0; }', /Duplicate local/],
  ] as const)('does not hide invalid bindings before semantic checking: %s', (source, error) => {
    expect(() => compile(source, { summarizeLoops: false })).toThrow(error);
    expect(() => compile(source, { summarizeLoops: true })).toThrow(error);
  });
});
