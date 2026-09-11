import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, test } from 'vitest';
import { compile } from '../src/compiler';
import { Machine, type MatrixBackend } from '../src/runtime';
import { createWasmBackend } from '../src/wasm';
import { originalPrime, trialDivisionPrime } from './fixtures/original-prime';

const source = (id: string) => readFileSync(new URL(`../examples/${id}.matrix`, import.meta.url), 'utf8');
let backend: MatrixBackend;
beforeAll(async () => { backend = await createWasmBackend(readFileSync('public/kernel.wasm')); });
function run(id: string, n?: number, text?: string, eof = false, budget = 1_000_000) {
  const artifact = compile(source(id), { name: id });
  const machine = new Machine(artifact, n === undefined ? {} : { n }, backend);
  if (text !== undefined) machine.enqueueInput(text);
  if (eof) machine.closeInput();
  machine.runBatch(budget);
  expect(machine.error).toBeNull();
  expect(machine.status, `${id} input ${n}, tick ${machine.tick}`).toBe('ended');
  return machine;
}
describe('requested programs execute as actual matrices', () => {
  test('compact parity has six coordinates and handles small inputs without devices', () => {
    const artifact = compile(source('parity'));
    expect(artifact.rows).toHaveLength(6);
    expect(artifact.devices).toEqual({});
    for (const n of [0, 1, 2, 3, 7, 16, 97, 65536]) {
      const m = new Machine(artifact, { n }, backend); m.runBatch(200_000);
      expect(m.error).toBeNull(); expect(m.status).toBe('ended');
      expect(m.state[artifact.result!], String(n)).toBe(n % 2 === 0 ? 1 : 0);
    }
    const large = new Machine(artifact, { n: 4294967295 }, backend); large.runBatch(4);
    expect(large.error).toBeNull(); expect(large.state[artifact.inputs.n]).toBe(4294967287);
    expect(large.status).toBe('ready'); // Valid full-u32 state; intentionally linear runtime.
  });
  test('simple prime agrees with the original 24-coordinate oracle', () => {
    const artifact = compile(source('prime-simple'));
    for (let n = 0; n <= 20; n++) {
      const m = new Machine(artifact, { n }, backend); m.runBatch(500_000);
      expect(m.error).toBeNull(); expect(m.status, `n=${n}`).toBe('ended');
      expect(Boolean(m.state[artifact.result!]), `n=${n}`).toBe(originalPrime(n).prime);
    }
  }, 60_000);
  test('optimized prime agrees with trial division', () => {
    const artifact = compile(source('prime-optimized'));
    for (const n of [...Array.from({ length: 70 }, (_, i) => i), 97, 121, 169, 997, 1021, 65535, 2147483648, 4294967295]) {
      const m = new Machine(artifact, { n }, backend); m.runBatch(1_000_000);
      expect(m.error).toBeNull(); expect(m.status, `n=${n}`).toBe('ended');
      expect(Boolean(m.state[artifact.result!]), `n=${n}`).toBe(trialDivisionPrime(n));
    }
  }, 60_000);
  test('optimized algorithm requires fewer updates for a prime input', () => {
    const simple = run('prime-simple', 31), optimized = run('prime-optimized', 31);
    expect(optimized.tick).toBeLessThan(simple.tick / 3);
  }, 60_000);
  test('hello writes exact text and draws H through six ports', () => {
    const m = run('hello');
    expect(m.consoleText).toBe('Hello, world!\n');
    expect(Object.keys(m.artifact.devices.screen!)).toHaveLength(6);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const on = ((x === 4 || x === 11) && y >= 3 && y <= 12) || (y === 7 && x >= 4 && x <= 11);
      expect([...m.pixels.slice((y * 16 + x) * 3, (y * 16 + x) * 3 + 3)]).toEqual(on ? [80, 220, 190] : [0, 0, 0]);
    }
    expect(m.events.filter(e => e.type === 'pixel')).toHaveLength(26);
  });
  test('greeting blocks for input then records and echoes Unicode name', () => {
    const a = compile(source('greeting')), m = new Machine(a, {}, backend);
    m.runBatch(100_000); expect(m.status).toBe('waiting');
    expect(m.consoleText).toBe('What is your name? ');
    const tick = m.tick; m.runBatch(30); expect(m.tick).toBe(tick);
    m.enqueueInput('Ada 🌍\n'); m.runBatch(300_000);
    expect(m.error).toBeNull(); expect(m.status).toBe('ended');
    expect(m.consoleText).toBe('What is your name? Greetings, Ada 🌍\n');
  }, 60_000);
  test('greeting accepts an empty name and EOF', () => {
    expect(run('greeting', undefined, '\n').consoleText).toBe('What is your name? Greetings, \n');
    expect(run('greeting', undefined, 'Grace', true).consoleText).toBe('What is your name? Greetings, Grace\n');
  }, 60_000);
  test('greeting bounds storage at 64 characters and drains excess', () => {
    const m = run('greeting', undefined, 'x'.repeat(67) + '\n', false, 2_000_000);
    expect(m.consoleText).toBe(`What is your name? Greetings, ${'x'.repeat(64)}\n`);
    expect(m.pendingInput).toBe(0);
  }, 120_000);
});
