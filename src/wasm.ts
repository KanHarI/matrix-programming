import type { Artifact } from './core/types';
import type { MatrixBackend } from './runtime';

/** A generic CSR matvec kernel, never a program-specific host interpreter. */
export async function createWasmBackend(bytes?: BufferSource): Promise<MatrixBackend> {
  const source = bytes ?? await (await fetch(`${import.meta.env?.BASE_URL ?? '/'}kernel.wasm`)).arrayBuffer();
  const { instance } = await WebAssembly.instantiate(source, {});
  const memory = instance.exports.memory as WebAssembly.Memory;
  const multiply = instance.exports.multiply as (n: number, offsets: number, cols: number, weights: number, state: number, raw: number) => void;
  const rectify = instance.exports.rectify as (n: number, raw: number, bounds: number, next: number) => number;
  let current: Artifact | undefined;
  let offsets = 0, cols = 0, weights = 0, state = 0, raw = 0, bounds = 0, next = 0;
  function configure(a: Artifact): void {
    if (a === current) return;
    const n = a.rows.length;
    const nnz = a.rows.reduce((sum, row) => sum + row.cols.length, 0);
    offsets = 0;
    cols = (n + 1) * 4;
    weights = cols + nnz * 4;
    state = weights + nnz * 4;
    raw = Math.ceil((state + n * 4) / 8) * 8;
    bounds = raw + n * 8;
    next = bounds + n * 4;
    const size = next + n * 4;
    if (size > memory.buffer.byteLength) memory.grow(Math.ceil((size - memory.buffer.byteLength) / 65536));
    const rowOffsets = new Uint32Array(memory.buffer, offsets, n + 1);
    const columnIndices = new Uint32Array(memory.buffer, cols, nnz);
    const coefficients = new Int32Array(memory.buffer, weights, nnz);
    let count = 0;
    a.rows.forEach((row, i) => {
      rowOffsets[i] = count;
      columnIndices.set(row.cols, count);
      coefficients.set(row.weights, count);
      count += row.cols.length;
    });
    rowOffsets[n] = count;
    new Uint32Array(memory.buffer, bounds, n).set(a.registers.map(r => r.bound));
    current = a;
  }
  return {
    name: 'WebAssembly / exact i64',
    multiply(a, x) {
      configure(a);
      new Uint32Array(memory.buffer, state, x.length).set(x);
      multiply(x.length, offsets, cols, weights, state, raw);
      // Return an owned snapshot: separate machines may safely share a backend.
      return new BigInt64Array(memory.buffer, raw, x.length).slice();
    },
    rectify(a, values) {
      configure(a);
      new BigInt64Array(memory.buffer, raw, values.length).set(values);
      const error = rectify(values.length, raw, bounds, next);
      return { next: new Uint32Array(memory.buffer, next, values.length).slice(), invalid: error - 1 };
    },
  };
}
