import { readFile, writeFile, mkdir } from 'node:fs/promises';
import wabtFactory from 'wabt';

const wabt = await wabtFactory();
const source = await readFile(new URL('../kernel.wat', import.meta.url), 'utf8');
const module = wabt.parseWat('kernel.wat', source);
module.resolveNames();
module.validate();
const { buffer } = module.toBinary({ canonicalize_lebs: true });
await mkdir(new URL('../public/', import.meta.url), { recursive: true });
await writeFile(new URL('../public/kernel.wasm', import.meta.url), buffer);
module.destroy();
console.log(`Built exact i64 CSR kernel (${buffer.byteLength} bytes)`);
