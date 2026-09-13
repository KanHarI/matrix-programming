// Terminal adapter only: computation and formatting happen in the .matrix program.
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

const argument = process.argv[2] ?? '4';
if (process.argv.length > 3 || !/^\d+$/.test(argument) || Number(argument) > 4294967295) {
  console.error('Usage: npm run matrix-computer -- [n: unsigned 32-bit integer]');
  process.exit(1);
}
const server = await createServer({ server: { middlewareMode: true, ws: false } });
try {
  const { compile } = await server.ssrLoadModule('/src/compiler.ts');
  const { Machine } = await server.ssrLoadModule('/src/runtime.ts');
  const { createWasmBackend } = await server.ssrLoadModule('/src/wasm.ts');
  const source = readFileSync(new URL('../examples/matrix-computer.matrix', import.meta.url), 'utf8');
  const artifact = compile(source);
  const backend = await createWasmBackend(readFileSync(new URL('../public/kernel.wasm', import.meta.url)));
  const machine = new Machine(artifact, { n: Number(argument) }, backend);
  console.error(`Outer computer: ${artifact.rows.length} x ${artifact.rows.length}. Inner computer: 6 x 6. Ctrl-C to stop.`);
  let printed = 0;
  while (machine.status === 'ready') {
    machine.runBatch(2048);
    const text = machine.consoleText.slice(printed);
    printed = machine.consoleText.length;
    if (text && !process.stdout.write(text)) {
      await new Promise(resolve => process.stdout.once('drain', resolve));
    }
    await new Promise(resolve => setImmediate(resolve));
  }
  if (machine.status !== 'ended') throw new Error(machine.error ?? `Machine ${machine.status}`);
  console.error(`Outer computer ended after ${machine.tick.toLocaleString()} ticks.`);
} finally {
  await server.close();
}
