import type { Artifact } from './core/types';

// A 2,543-coordinate greeting program fits (~20 MB of mostly zero entries).
// Larger exports should use the existing sparse JSON/CSV download instead.
const MAX_ENTRIES = 10_000_000;
const MAX_TEXT_BYTES = 32 * 1024 * 1024;

function checkLength(length: number, label: string): void {
  if (!Number.isSafeInteger(length) || length < 0) throw new Error(`${label} length must be a nonnegative safe integer`);
  if (length > MAX_ENTRIES) throw new Error(`${label} copy exceeds the 10,000,000-entry limit; use a sparse JSON/CSV export instead`);
}

function checkText(length: number): void {
  // Output consists exclusively of ASCII integer literals and punctuation.
  if (length > MAX_TEXT_BYTES) throw new Error('Copy exceeds the 32 MiB text limit; use a sparse JSON/CSV export instead');
}

function integer(value: number | bigint, label: string): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error(`${label} must be a safe integer number or bigint`);
  return BigInt(value);
}

/** Full W[destination][source], including zeros; valid Python and JSON syntax. */
export function matrixPython(artifact: Artifact): string {
  const size = artifact.rows.length;
  checkLength(size, 'Matrix dimension');
  checkLength(size * size, 'Dense matrix');
  if (artifact.registers.length !== size) throw new Error('Matrix rows and register dimensions must match');
  if (size === 0) return '[]';
  const lines: string[] = [];
  let textLength = 4, storedEntries = 0;
  for (let destination = 0; destination < size; destination++) {
    const sparse = artifact.rows[destination];
    if (!sparse || sparse.cols.length !== sparse.weights.length) throw new Error(`Malformed sparse matrix row ${destination}`);
    storedEntries += sparse.cols.length;
    checkLength(storedEntries, 'Sparse matrix');
    // Only one numeric row exists at a time, never an N×N numeric allocation.
    const dense = new Array<bigint>(size).fill(0n);
    for (let entry = 0; entry < sparse.cols.length; entry++) {
      const source = sparse.cols[entry];
      if (!Number.isSafeInteger(source) || source < 0 || source >= size) throw new Error(`Matrix column ${source} in row ${destination} is out of range`);
      dense[source] += integer(sparse.weights[entry], `Matrix weight in row ${destination}`);
    }
    const line = `  [${dense.join(', ')}]`;
    textLength += line.length + (destination > 0 ? 2 : 0);
    checkText(textLength);
    lines.push(line);
  }
  return `[\n${lines.join(',\n')}\n]`;
}

/** Flat integer literals without bigint suffixes or scientific notation. */
export function vectorPython(vector: ArrayLike<number | bigint>): string {
  checkLength(vector.length, 'Vector');
  const chunks: string[] = [];
  let chunk: string[] = [], textLength = 2;
  for (let index = 0; index < vector.length; index++) {
    const literal = integer(vector[index], `Vector coordinate ${index}`).toString();
    textLength += literal.length + (index > 0 ? 2 : 0);
    checkText(textLength);
    chunk.push(literal);
    if (chunk.length === 4096) { chunks.push(chunk.join(', ')); chunk = []; }
  }
  if (chunk.length) chunks.push(chunk.join(', '));
  return `[${chunks.join(', ')}]`;
}
