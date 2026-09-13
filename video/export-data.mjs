import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const here = fileURLToPath(new URL('.', import.meta.url));
const server = await createServer({ server: { middlewareMode: true, ws: false } });
try {
  const { compile } = await server.ssrLoadModule('/src/compiler.ts');
  const { optimizationDefinitions } = await server.ssrLoadModule('/src/compiler-options.ts');
  const { Machine, referenceBackend } = await server.ssrLoadModule('/src/runtime.ts');
  const { createWasmBackend } = await server.ssrLoadModule('/src/wasm.ts');
  const backend = await createWasmBackend(readFileSync(new URL('../public/kernel.wasm', import.meta.url)));
  const source = id => readFileSync(new URL(`../examples/${id}.matrix`, import.meta.url), 'utf8');
  const disabled = Object.fromEntries(optimizationDefinitions.map(({ key }) => [key, false]));
  const summary = artifact => ({
    size: artifact.rows.length,
    nonzeros: artifact.rows.reduce((n, row) => n + row.cols.length, 0),
    instructions: artifact.stats.instructions,
    registers: artifact.registers,
    rows: artifact.rows,
    inputs: artifact.inputs,
    result: artifact.result,
    end: artifact.end,
    initial: artifact.initial,
    markers: artifact.markers,
    functions: artifact.stats.functionInstances,
  });
  const parity = compile(source('parity'));
  assert.equal(parity.rows.length, 6);
  const parityTrace = n => {
    const machine = new Machine(parity, { n }, referenceBackend);
    const steps = [{ tick: 0, state: [...machine.state] }];
    while (machine.status === 'ready' && machine.tick < 20) {
      assert.equal(machine.stepPhase(), true);
      const raw = [...machine.raw].map(Number);
      assert.equal(machine.stepPhase(), true);
      const candidate = machine.candidate.map(Number);
      assert.equal(machine.stepPhase(), true);
      steps.push({ tick: machine.tick, raw, candidate, state: [...machine.state] });
    }
    assert.equal(machine.status, 'ended');
    assert.equal(machine.state[parity.result], Number(n % 2 === 0));
    return steps;
  };
  const compact = compile(source('prime-simple'));
  const clocked = compile(source('prime-simple'), { optimizations: { counterMachine: false } });
  const unoptimized = compile(source('prime-simple'), { optimizations: disabled });
  const primeTrace = n => {
    const machine = new Machine(unoptimized, { n }, backend);
    const ids = ['n', 'divisor', 'count', 'remainder', 'result'].map(name => unoptimized.registers.findIndex(r => r.name === `main.main.${name}`));
    assert(ids.every(id => id >= 0));
    const trace = [];
    let previous = '';
    while (machine.status === 'ready' && machine.tick < 100_000) {
      const values = ids.map(id => machine.state[id]);
      if (values.join() !== previous) {
        trace.push({ tick: machine.tick, values, active: unoptimized.markers.filter(m => machine.state[m.register]).map(m => ({ line: m.line, label: m.label })) });
        previous = values.join();
      }
      machine.step();
    }
    assert.equal(machine.status, 'ended');
    trace.push({ tick: machine.tick, values: ids.map(id => machine.state[id]), end: machine.state[unoptimized.end] });
    return { ticks: machine.tick, result: machine.state[unoptimized.result], trace };
  };
  const composite = primeTrace(6), prime = primeTrace(7);
  assert.equal(composite.result, 0); assert.equal(prime.result, 1);
  const factorial = compile(source('recursive-factorial'));
  const factorialSmall = compile(source('recursive-factorial'), { recursionDepth: 4 });
  const fm = new Machine(factorialSmall, { n: 4 }, backend);
  fm.runBatch(100_000);
  assert.equal(fm.status, 'ended'); assert.equal(fm.state[factorialSmall.result], 24);
  const sharedSource = 'fn bump(v) { return v + 1; } fn main(n) { let first = bump(n); return bump(first); }';
  const shared = compile(sharedSource);
  assert.equal(shared.stats.functionInstances.filter(name => name.endsWith('.bump')).length, 1);
  const data = {
    schema: 1,
    parity: { ...summary(parity), dense: parity.rows.map(row => Array.from({ length: 6 }, (_, c) => row.weights[row.cols.indexOf(c)] ?? 0)), even: parityTrace(4), odd: parityTrace(5) },
    prime: { source: source('prime-simple'), compact: summary(compact), clocked: summary(clocked), unoptimized: summary(unoptimized), disabled, composite, prime },
    factorial: { source: source('recursive-factorial'), size: factorial.rows.length, sizeAtDepth4: factorialSmall.rows.length, depth: 16, resultAt4: 24, ticksAt4: fm.tick },
    shared: { source: sharedSource, size: shared.rows.length, functions: shared.stats.functionInstances },
  };
  mkdirSync(`${here}data`, { recursive: true });
  writeFileSync(`${here}data/compiler.json`, JSON.stringify(data, null, 2) + '\n');
  console.log(JSON.stringify({ parity: data.parity.size, primeDefault: compact.rows.length, primeClocked: clocked.rows.length, primeAllOff: unoptimized.rows.length, nonzerosAllOff: data.prime.unoptimized.nonzeros, n6Ticks: composite.ticks, n7Ticks: prime.ticks, factorial: data.factorial.size }, null, 2));
} finally { await server.close(); }
