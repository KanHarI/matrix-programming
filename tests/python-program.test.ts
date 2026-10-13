import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compile } from '../src/compiler';
import type { Artifact } from '../src/core/types';
import { examples } from '../src/examples';
import { pythonProgram, pythonString } from '../src/python-program';
import { Machine, type MatrixBackend } from '../src/runtime';
import { createWasmBackend } from '../src/wasm';

// CI always has python3; a contributor without it can still run the other suites.
const hasPython = spawnSync('python3', ['--version']).status === 0;
let backend: MatrixBackend;
let directory: string;
beforeAll(async () => {
  backend = await createWasmBackend(readFileSync('public/kernel.wasm'));
  directory = mkdtempSync(join(tmpdir(), 'matrix-python-'));
});
afterAll(() => { if (directory) rmSync(directory, { recursive: true, force: true }); });

interface Outcome { status: number | null; stdout: string; stderr: string }
let scripts = 0;
function python(program: string, args: (number | string)[] = [], stdin = ''): Outcome {
  const path = join(directory, `program${scripts++}.py`);
  writeFileSync(path, program);
  const result = spawnSync('python3', ['-I', '-X', 'utf8', path, ...args.map(String)], { input: stdin, encoding: 'utf8', timeout: 60_000 });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** What the generated script must print, derived from the browser's own Machine. */
function expected(artifact: Artifact, inputs: Record<string, number>, stdin?: string): Outcome {
  const machine = new Machine(artifact, inputs, backend);
  if (stdin !== undefined) { if (stdin) machine.enqueueInput(stdin); machine.closeInput(); }
  machine.runBatch(10_000_000);
  expect(['ended', 'fault']).toContain(machine.status);
  let stdout = machine.consoleText;
  if (stdout && !stdout.endsWith('\n')) stdout += '\n';
  if (machine.status === 'fault') return { status: 1, stdout, stderr: `Fault after ${machine.tick} ticks: ${machine.error}\n` };
  if (machine.pixels.some(Boolean)) {
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) stdout += machine.pixels.subarray((y * 16 + x) * 3, (y * 16 + x) * 3 + 3).some(Boolean) ? '#' : '.';
      stdout += '\n';
    }
  }
  if (artifact.result !== undefined) stdout += `result = ${machine.state[artifact.result]}\n`;
  return { status: 0, stdout, stderr: `Ended after ${machine.tick} ticks.\n` };
}

function agree(artifact: Artifact, defaults: Record<string, number>, args: number[] = [], stdin?: string): Outcome {
  const inputs = Object.fromEntries(Object.keys(artifact.inputs).map((name, i) => [name, args[i] ?? defaults[name] ?? 0]));
  const actual = python(pythonProgram(artifact, defaults), args, stdin);
  expect(actual).toEqual(expected(artifact, inputs, stdin));
  return actual;
}

it('refuses devices the script cannot model instead of exporting a different program', () => {
  const artifact = compile('fn main() { return 0; }');
  const extended = { ...artifact, devices: { ...artifact.devices, screenRead: { x: 0, y: 0, request: 0, r: 0, g: 0, b: 0 } } } as Artifact;
  expect(() => pythonProgram(extended)).toThrow('Python export does not support the screenRead device yet');
});

describe.skipIf(!hasPython && !process.env.CI)('copied Python program', () => {
  // The 4,019-coordinate matrix computer needs ~293,000 ticks; it is too slow for pure Python here.
  const presets = examples.filter(example => example.id !== 'matrix-computer' && example.id !== 'prime-binary');

  it.each(presets.map(example => [example.id, example]))('runs the %s preset to its end gate exactly like Machine', (_, example) => {
    const artifact = compile(example.source, { name: example.name });
    agree(artifact, example.inputs, [], artifact.devices.consoleInput ? 'Ada Lovelace\n' : undefined);
  }, 60_000);

  it('takes n from the command line and defaults to the copied value', () => {
    const parity = examples.find(example => example.id === 'parity')!;
    const artifact = compile(parity.source, { name: parity.name });
    expect(agree(artifact, { n: 42 }).stdout).toBe('result = 1\n');
    for (const n of [0, 1, 7, 100]) expect(agree(artifact, { n: 42 }, [n]).stdout).toBe(`result = ${n % 2 === 0 ? 1 : 0}\n`);
    const binary = examples.find(example => example.id === 'prime-binary')!;
    for (const n of [91, 97]) agree(compile(binary.source), binary.inputs, [n]);
  }, 60_000);

  it('rejects inputs outside the coordinate bound with a usage error', () => {
    const program = pythonProgram(compile('fn main(n) { return n; }'), { n: 3 });
    for (const n of ['4294967296', '-1', 'seven']) {
      const outcome = python(program, [n]);
      expect(outcome.status).toBe(2);
      expect(outcome.stdout).toBe('');
      expect(outcome.stderr).toMatch(/usage: .* \[n\]/);
    }
    expect(python(program, ['4294967296']).stderr).toContain('Input n must be an integer from 0 to 4294967295');
  });

  it('feeds console input one character per request, including end of file and truncation', () => {
    const greeting = examples.find(example => example.id === 'greeting')!;
    const artifact = compile(greeting.source);
    expect(agree(artifact, {}, [], 'Zoë 😀\nignored').stdout).toBe('What is your name? Greetings, Zoë 😀\nresult = 1\n');
    expect(agree(artifact, {}, [], '').stdout).toBe('What is your name? Greetings, \nresult = 1\n');
    agree(artifact, {}, [], `${'abcdefghij'.repeat(8)}\n`);
  }, 60_000);

  it.each([
    ['an overflowing product', compile(examples.find(example => example.id === 'recursive-factorial')!.source), [13]],
    ['an array index fault gate', compile('fn main(n) { let a[3]; a[0] = 5; return a[n]; }'), [3]],
    ['the recursion depth limit', compile('rec fn f(n) { if (n == 0) { return 0; } return f(n - 1); } fn main(n) { return f(n); }'), [20]],
    ['an invalid console scalar after partial output', compile('fn main(n) { print("ok"); putc(n); return 0; }'), [0xd800]],
    ['an off-screen pixel', compile('fn main(n) { pixel(n, 0, 1, 2, 3); return 0; }'), [16]],
  ] as const)('stops with the same fault message and tick as Machine on %s', (_, artifact, args) => {
    const outcome = agree(artifact, {}, [...args]);
    expect(outcome.status).toBe(1);
    expect(outcome.stderr).toMatch(/^Fault after \d+ ticks: /);
  }, 60_000);

  it('streams Unicode output and draws pixels', () => {
    const outcome = agree(compile('fn main(n) { print("héllo ✓ "); putc(n); pixel(15, 15, 255, 0, 9); return 0; }'), { n: 0x1f600 });
    expect(outcome.stdout).toMatch(/^héllo ✓ 😀\n(?:\.{16}\n){15}\.{15}#\nresult = 0\n$/);
  });

  it('accepts several parameters, including names that are Python keywords', () => {
    const artifact = compile('fn main(lambda, pass) { return lambda + pass; }');
    expect(agree(artifact, { lambda: 3, pass: 4 }).stdout).toBe('result = 7\n');
    expect(agree(artifact, { lambda: 3, pass: 4 }, [10, 20]).stdout).toBe('result = 30\n');
    expect(agree(artifact, { lambda: 3, pass: 4 }, [10]).stdout).toBe('result = 14\n');
  });

  it('keeps arbitrary program names and source text inert', () => {
    const source = 'fn main(n) { return n; } // """ \\ \' \u0000 \u2028 \ud800 end\r// after a lone CR\r\n';
    const artifact = compile(source, { name: 'Weird """ \\ name\n' });
    expect(agree(artifact, { n: 5 }).stdout).toBe('result = 5\n');
    const outcome = python(pythonProgram(artifact, { n: 5 }), ['--help']);
    expect(outcome.status).toBe(0);
    expect(outcome.stdout).toContain('Weird """ \\ name');
    expect(outcome.stdout).toContain('Run it with: python3 program.py 5');
  });

  it('writes string literals that Python reads back unchanged', () => {
    const strings = ['', "it's", 'say "hi"', 'both \' and "', 'back\\slash', 'tab\tnew\nline\r', '\u0000\u001f\u007f\u0085', 'ü × 😀', '\u2028\u2029\ufeff', 'lone \ud800 \udfff'];
    const outcome = python(`import json\nprint(json.dumps([${strings.map(pythonString).join(', ')}]))\n`);
    expect(outcome.stderr).toBe('');
    expect(JSON.parse(outcome.stdout)).toEqual(strings);
  });
});
