export const MAX_U32 = 0xffff_ffff;
export interface Register {
  name: string;
  kind: 'data' | 'control' | 'temporary' | 'constant' | 'io';
  bound: number;
  line?: number;
  context?: string;
}
export interface SparseRow { cols: number[]; weights: number[] }
export interface Devices {
  consoleOutput?: { codepoint: number; emit: number };
  consoleInput?: { request: number; available: number; eof: number; codepoint: number };
  screen?: { x: number; y: number; r: number; g: number; b: number; emit: number };
}
export interface Artifact {
  version: 1;
  name: string;
  source: string;
  rows: SparseRow[];
  registers: Register[];
  initial: number[];
  inputs: Record<string, number>;
  result?: number;
  end: number;
  led?: number;
  devices: Devices;
  faults?: { register: number; message: string }[];
  markers: { register: number; line: number; label: string; context: string }[];
  stats: { instructions: number; contexts: number; functionInstances: string[] };
}
export interface CompileOptions {
  name?: string;
  devices?: { consoleOutput?: boolean; consoleInput?: boolean; screen?: boolean; led?: boolean };
}
