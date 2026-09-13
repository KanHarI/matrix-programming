import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { compile } from '../src/compiler';
import { Machine, type MatrixBackend } from '../src/runtime';
import { createWasmBackend } from '../src/wasm';

const source = readFileSync(new URL('../examples/matrix-computer.matrix', import.meta.url), 'utf8');
const artifact = compile(source);
const parity = compile(readFileSync(new URL('../examples/parity.matrix', import.meta.url), 'utf8'));
const dense = parity.rows.map(row => Array.from({ length: 6 }, (_, col) => {
  const index = row.cols.indexOf(col);
  return index < 0 ? 0 : row.weights[index]!;
}));
let backend: MatrixBackend;
beforeAll(async () => { backend = await createWasmBackend(readFileSync('public/kernel.wasm')); });

describe('Matrix-language matrix computer', () => {
  it('uses ordinary compiled functions, arrays and output ports, without extra input or screen devices', () => {
    expect(artifact.devices.consoleOutput).toBeDefined();
    expect(artifact.devices.consoleInput).toBeUndefined();
    expect(artifact.devices.screen).toBeUndefined();
    expect(artifact.stats.functionInstances).toEqual(['main.main', 'main.number', 'main.multiply']);
    expect(artifact.rows.length).toBeLessThanOrEqual(4020);
  });

  it.each([0, 1, 2, 4, 5, 12])('prints every inner update exactly like the real 6x6 matrix for n=%i', n => {
    const machine = new Machine(artifact, { n }, backend);
    machine.runBatch(800_000);
    expect(machine.error).toBeNull();
    expect(machine.status).toBe('ended');
    const printedMatrix = [...machine.consoleText.matchAll(/^  (\[.*\])$/gm)].map(match => JSON.parse(match[1]!));
    expect(printedMatrix).toEqual(dense);
    const blocks = [...machine.consoleText.matchAll(/Tick (\d+) -> (\d+)\nx = (\[.*\])\nz = W x = (\[.*\])\nReLU\(z\) = (\[.*\])\nCommit x <- ReLU\(z\)\n/g)];
    const inner = new Machine(parity, { n }, backend);
    for (const block of blocks) {
      expect(inner.status).toBe('ready');
      expect(Number(block[1])).toBe(inner.tick);
      expect(Number(block[2])).toBe(inner.tick + 1);
      expect(JSON.parse(block[3]!)).toEqual([...inner.state]);
      inner.stepPhase();
      expect(JSON.parse(block[4]!)).toEqual([...inner.raw!].map(Number));
      inner.stepPhase();
      expect(JSON.parse(block[5]!)).toEqual(inner.candidate!.map(Number));
      inner.stepPhase();
    }
    expect(inner.status).toBe('ended');
    expect(blocks).toHaveLength(Math.floor(n / 2) + 2);
    const result = inner.state[parity.result!]!;
    expect(machine.state[artifact.result!]).toBe(result);
    expect(machine.consoleText.endsWith(`END = 1; LED = ${result} (${result ? 'even' : 'odd'})\n`)).toBe(true);
  }, 30_000);

  it.each([0, 9, 10, 100, 2147483648, 4294967295])('formats %i using source code, including zero and full-u32 values', n => {
    const helper = compile(source.slice(0, source.indexOf('fn main(n)')) + 'fn main(n) { number(n); return 0; }');
    const machine = new Machine(helper, { n }, backend);
    machine.runBatch(30_000);
    expect(machine.error).toBeNull();
    expect(machine.status).toBe('ended');
    expect(machine.consoleText).toBe(String(n));
  });
});
