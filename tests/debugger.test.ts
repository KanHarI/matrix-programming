import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { compile } from '../src/compiler';
import { activeMarkers, breakpointCondition, diagnosticLine, lineStepCondition, markerLines, stateChanges, type StopCondition, type StopReason } from '../src/debugger';
import { Machine, referenceBackend, type MatrixBackend } from '../src/runtime';
import { createWasmBackend } from '../src/wasm';

let backend: MatrixBackend;
beforeAll(async () => { backend = await createWasmBackend(Uint8Array.from(readFileSync('public/kernel.wasm'))); });

const fibonacci = `fn main(n) {
  let a = 0;
  let b = 1;
  while (n > 0) {
    let t = a + b;
    a = b;
    b = t;
    n = n - 1;
  }
  return a;
}`;

/** Commit whole ticks until the condition reports a reason or execution stops. */
function runUntil(machine: Machine, condition: StopCondition, limit = 100_000): StopReason | undefined {
  for (let i = 0; i < limit && machine.step(); i++) {
    const reason = condition(machine.state);
    if (reason) return reason;
  }
  return undefined;
}
const lines = (machine: Machine) => [...new Set(activeMarkers(machine.artifact, machine.state).map(marker => marker.line))];

describe('source-level debugging helpers', () => {
  it('steps through the source one instruction at a time, following the loop', () => {
    const machine = new Machine(compile(fibonacci), { n: 2 }, backend);
    expect(lines(machine)).toEqual([2]);
    const visited: number[][] = [];
    for (let i = 0; i < 40 && machine.status === 'ready'; i++) {
      const reason = runUntil(machine, lineStepCondition(machine.artifact, machine.state));
      if (!reason) break;
      expect(reason.kind).toBe('line');
      expect(reason.kind === 'line' && reason.lines).toEqual(lines(machine));
      visited.push(lines(machine));
    }
    // `return a;` compiles to two instructions (write result, return) but is one line step.
    expect(visited.flat()).toEqual([3, 4, 5, 6, 7, 8, 4, 5, 6, 7, 8, 4, 10]);
    expect(machine.status).toBe('ended');
    expect(machine.state[machine.artifact.result!]).toBe(1);
  });

  it('stops at breakpoints each time their instruction is entered, and can resume past them', () => {
    const artifact = compile(fibonacci);
    expect([...markerLines(artifact)].sort((x, y) => x - y)).toEqual([2, 3, 4, 5, 6, 7, 8, 10]);
    const machine = new Machine(artifact, { n: 3 }, backend);
    const hits: number[] = [];
    for (let i = 0; i < 10; i++) {
      const condition = breakpointCondition(artifact, new Set([6, 1]), machine.state)!;
      const reason = runUntil(machine, condition);
      if (!reason) break;
      expect(reason).toEqual({ kind: 'breakpoint', line: 6 });
      hits.push(machine.state[artifact.inputs.n!]!);
    }
    // Paused before line 6 executes in each of the three iterations; n is decremented later, on line 8.
    expect(hits).toEqual([3, 2, 1]);
    expect(machine.status).toBe('ended');
    expect(breakpointCondition(artifact, new Set([1, 9]), machine.state)).toBeUndefined();
  });

  it('passes over routing ticks without an active instruction instead of stopping there', () => {
    const source = 'fn inc(x) { return x + 1; }\nfn main(n) {\n  let a = inc(n);\n  let b = inc(a);\n  return b;\n}';
    const machine = new Machine(compile(source), { n: 5 }, backend);
    for (let i = 0; i < 30 && machine.status === 'ready'; i++) {
      if (!runUntil(machine, lineStepCondition(machine.artifact, machine.state))) break;
      expect(lines(machine).length).toBeGreaterThan(0);
    }
    expect(machine.status).toBe('ended');
    expect(machine.state[machine.artifact.result!]).toBe(7);
  });

  it('lists every changed coordinate with its old and new value', () => {
    expect(stateChanges([1, 2, 3, 4], [1, 5, 3, 0])).toEqual([{ index: 1, from: 2, to: 5 }, { index: 3, from: 4, to: 0 }]);
    expect(stateChanges([7], [7])).toEqual([]);
  });

  it('reads the line from compiler and parser diagnostics', () => {
    expect(diagnosticLine("Line 3, column 12: Missing ';' after '1'")).toBe(3);
    expect(diagnosticLine('Line 14: Unknown variable')).toBe(14);
    expect(diagnosticLine('Register main.alu exceeds its 4294967295 bound')).toBeUndefined();
  });
});

describe('fault diagnostics', () => {
  // A loop selects the general backend, whose instructions carry source markers.
  const overflow = 'fn main(n) {\n  let total = 4294967295;\n  while (n > 0) { total = total + n; n = 0; }\n  return total;\n}';
  it.each([['WASM', () => backend], ['reference', () => referenceBackend]] as const)('%s fast path reports the overflowing register and its exact value', (_, choose) => {
    const machine = new Machine(compile(overflow), { n: 2 }, choose());
    machine.runBatch(10_000);
    expect(machine.status).toBe('fault');
    expect(machine.faultRegister).not.toBeNull();
    const register = machine.artifact.registers[machine.faultRegister!]!;
    expect(machine.error).toBe(`Register ${register.name} exceeds its 4294967295 bound (4294967297)`);
    // The failed candidate is not committed; its signed sum stays available for inspection.
    expect(machine.raw?.[machine.faultRegister!]).toBe(4294967297n);
    expect(activeMarkers(machine.artifact, machine.state).map(marker => marker.line)).toEqual([3]);
  });

  it('phase-stepped commit reports the same register and value', () => {
    const machine = new Machine(compile(overflow), { n: 2 }, backend);
    while (machine.status === 'ready') machine.stepPhase();
    expect(machine.status).toBe('fault');
    expect(machine.error).toMatch(/exceeds its 4294967295 bound \(4294967297\)$/);
    expect(machine.faultRegister).not.toBeNull();
  });

  it('attributes compiled gated faults to their fault coordinate and clears on reset', () => {
    const source = 'rec fn descend(n) { if (n == 0) { return 17; } return descend(n - 1); } fn main(n) { return descend(n); }';
    const artifact = compile(source, { recursionDepth: 2 });
    const machine = new Machine(artifact, { n: 3 }, backend);
    machine.runBatch(10_000);
    expect(machine.error).toMatch(/recursion depth limit 2 exceeded/);
    expect(artifact.faults?.some(fault => fault.register === machine.faultRegister)).toBe(true);
    machine.reset();
    expect(machine.faultRegister).toBeNull();
    expect(machine.error).toBeNull();
  });
});
