import { parse } from './parser';
import { compileStraightLine, pruneArtifact } from './compact';
import { compileCountdown } from './countdown';
import { summarizeLoops } from './loop-summary';
import { lowerCounterMachine } from './counter-machine';
import { resolveOptimizations, type OptimizationFlags } from './compiler-options';
import type { Expr, FunctionDecl, Stmt } from './core/ast';
import { MAX_U32, type Artifact, type CompileOptions, type Register } from './core/types';

// All control, calls, selection, arithmetic and joins below become constant rows
// of W. There is no instruction interpreter in the runtime.
const HALF = 0x7fff_ffff;
type Terms = [number, number][];
class Matrix {
  constructor(private optimizations: OptimizationFlags) {}
  registers: Register[] = [];
  initial: number[] = [];
  rows: Map<number, number>[] = [];
  constants = new Map<number, number>();
  gateDelays = new Map<number, [number, number]>();
  add(name: string, kind: Register['kind'] = 'temporary', bound = MAX_U32, initial = 0, context?: string, line?: number) {
    if (this.registers.length >= 100_000) throw new Error('Compiler safety limit: at most 100,000 matrix coordinates');
    const id = this.registers.length;
    this.registers.push({ name, kind, bound, context, line });
    this.initial.push(initial); this.rows.push(new Map()); return id;
  }
  terms(dst: number, terms: Terms) {
    for (const [src, weight] of terms) {
      const w = (this.rows[dst].get(src) ?? 0) + weight;
      if (w < -0x8000_0000 || w > HALF) throw new Error('Internal error: coefficient exceeds i32');
      if (w) this.rows[dst].set(src, w); else this.rows[dst].delete(src);
    }
  }
  row(name: string, terms: Terms, bound = MAX_U32, context?: string) {
    const id = this.add(name, 'temporary', bound, 0, context); this.terms(id, terms); return id;
  }
  hold(id: number) { this.terms(id, [[id, 1]]); }
  constant(value: number) {
    if (!Number.isInteger(value) || value < 0 || value > MAX_U32) throw new Error(`Integer ${value} is outside nat (0..${MAX_U32})`);
    let id = this.constants.get(value);
    if (id === undefined) { id = this.add(`constant.${value}`, 'constant', value, value); this.hold(id); this.constants.set(value, id); }
    return id;
  }
  delay(src: number, count: number, name: string, bound = 1, context?: string) {
    for (let i = 0; i < count; i++) src = this.row(`${name}.${i + 1}`, [[src, 1]], bound, context);
    return src;
  }
  // Full-u32 selection using only signed-i32 weights. Subtracting 2H+1
  // across three stages kills even UINT32_MAX when the selector is zero.
  gate(value: number, bit: number, name: string, context: string) {
    const one = this.constant(1);
    const bound = this.registers[value].bound;
    if (this.optimizations.boundedGates && bound <= HALF) {
      // Small bounded words need one selection stage, followed by two timing
      // stages. They do not need the full-u32 three-part subtraction circuit.
      const selected = this.row(`${name}.selected`, [[value, 1], [one, -bound], [bit, bound]], bound, context);
      return this.delay(selected, 2, `${name}.value`, bound, context);
    }
    let delays = this.optimizations.sharedGateDelays ? this.gateDelays.get(bit) : undefined;
    if (!delays) {
      const d1 = this.delay(bit, 1, `${name}.select`, 1, context);
      delays = [d1, this.delay(d1, 1, `${name}.select2`, 1, context)];
      this.gateDelays.set(bit, delays);
    }
    const [d1, d2] = delays;
    const g1 = this.row(`${name}.high1`, [[value, 1], [one, -HALF], [bit, HALF]], MAX_U32, context);
    const g2 = this.row(`${name}.high2`, [[g1, 1], [one, -HALF], [d1, HALF]], MAX_U32, context);
    return this.row(`${name}.value`, [[g2, 1], [one, -1], [d2, 1]], MAX_U32, context);
  }
}

type Op = 'alu' | 'branch' | 'jump' | 'call' | 'ret' | 'emit' | 'readRequest' | 'readReceive' | 'fork' | 'halt';
interface Instruction {
  op: Op; line: number; label: string; context: Context;
  a?: number; b?: number; c?: number; target?: number;
  next?: Instruction; yes?: Instruction; no?: Instruction;
  callee?: Fn; continuation?: Instruction; flag?: number;
  owner?: Fn; branches?: Fn[]; emit?: number;
  directDelta?: number;
  directSet?: number;
  comparison?: string;
  returnValue?: number;
  pc?: number; dispatch?: number; preDispatch?: number;
}
interface Fn { decl: FunctionDecl; instanceName: string; depth: number; context: Context; params: number[]; result: number; code: Instruction[]; calls: Instruction[]; root: boolean; done?: number }
interface Context { name: string; functions: Map<string, Fn>; code: Instruction[]; pure: boolean; root?: Fn }
type Binding = number | number[];

export function compile(source: string, options: CompileOptions = {}): Artifact {
  const optimizations = resolveOptimizations(options);
  if (source.length > 100_000) throw new Error('Compiler safety limit: at most 100,000 source characters');
  const recursionDepth = options.recursionDepth ?? 16;
  if (!Number.isInteger(recursionDepth) || recursionDepth < 1 || recursionDepth > 32) throw new Error('recursionDepth must be an integer from 1 to 32');
  const parsed = parse(source);
  const program = optimizations.loopSummaries ? summarizeLoops(parsed) : parsed;
  const definitions = new Map<string, FunctionDecl>();
  const fail = (message: string, line?: number): never => { throw new Error(`${line ? `Line ${line}: ` : ''}${message}`); };
  for (const fn of program.functions) {
    if (definitions.has(fn.name)) fail(`Duplicate function '${fn.name}'`, fn.line);
    if (fn.recursive && fn.name === 'main') fail('main cannot be declared recursive; call a rec fn helper instead', fn.line);
    if (new Set(fn.params).size !== fn.params.length) fail(`Duplicate parameter in '${fn.name}'`, fn.line);
    definitions.set(fn.name, fn);
  }
  if (!definitions.has('main')) fail('A main function is required');
  const builtinNames = new Set(['print', 'putc', 'pixel', 'read', 'halt', 'led']);
  for (const name of definitions.keys()) if (builtinNames.has(name)) fail(`'${name}' is a reserved device builtin`);
  // Validate the whole call graph, including unused functions. Recursion cannot
  // accidentally alias a live activation's registers or return address.
  const callsIn = (value: unknown, result: string[] = []): string[] => {
    if (value && typeof value === 'object') {
      const v = value as Record<string, unknown>;
      if (v.kind === 'call' && typeof v.name === 'string') result.push(v.name);
      for (const child of Object.values(v)) if (child && typeof child === 'object') callsIn(child, result);
    }
    return result;
  };
  const active = new Set<string>(), visited = new Set<string>();
  function visit(name: string) {
    if (active.has(name)) {
      const path = [...active];
      const cycle = [...path.slice(path.indexOf(name)), name];
      if (cycle.some(member => definitions.get(member)!.recursive)) fail(`Mutual recursion is not supported; rec fn currently supports direct self recursion only (${cycle.join(' → ')})`);
      fail(`Recursion is not allowed in regular functions (${cycle.join(' → ')})`);
    }
    if (visited.has(name)) return;
    active.add(name);
    for (const callee of callsIn(definitions.get(name)!.body)) {
      if (builtinNames.has(callee)) continue;
      if (!definitions.has(callee)) fail(`Unknown function '${callee}'`, definitions.get(name)!.line);
      if (callee === 'main') fail('main cannot be called as a helper');
      if (callee === name && definitions.get(name)!.recursive) continue;
      visit(callee);
    }
    active.delete(name); visited.add(name);
  }
  for (const name of definitions.keys()) visit(name);

  const countdown = optimizations.countdown ? compileCountdown(program, source, options) : undefined;
  if (countdown) return countdown;
  const straightLine = optimizations.straightLine ? compileStraightLine(program, source, options) : undefined;
  if (straightLine) return optimizations.prune ? pruneArtifact(straightLine) : straightLine;

  const m = new Matrix(optimizations), one = m.constant(1), zero = m.constant(0);
  const end = m.add('end', 'control', 1); m.hold(end);
  const devices: Artifact['devices'] = {};
  const faults: NonNullable<Artifact['faults']> = [];
  const contexts: Context[] = [];
  let serial = 0, instructionCount = 0, led: number | undefined;
  const data = (name: string, context: string, line: number, bound = MAX_U32) => {
    const id = m.add(name, 'data', bound, 0, context, line); m.hold(id); return id;
  };
  const newContext = (name: string, pure: boolean) => {
    if (contexts.length >= 32) fail('Compiler safety limit: at most 32 execution contexts');
    const c: Context = { name, functions: new Map(), code: [], pure }; contexts.push(c); return c;
  };
  function device(name: 'consoleOutput' | 'consoleInput' | 'screen', context: Context, line: number) {
    if (context.pure) fail(`Parallel computations must be pure; '${name}' is an I/O effect`, line);
    if (options.devices?.[name] === false) fail(`The ${name} device is disabled`, line);
    if (!devices[name]) {
      const port = (label: string, bound: number, retained = false) => {
        const id = m.add(`${name}.${label}`, 'io', bound); if (retained) m.hold(id); return id;
      };
      if (name === 'consoleOutput') devices.consoleOutput = { codepoint: port('codepoint', MAX_U32, true), emit: port('emit', 1) };
      if (name === 'consoleInput') devices.consoleInput = { request: port('request', 1), available: port('available', 1), eof: port('eof', 1), codepoint: port('codepoint', 0x10ffff) };
      if (name === 'screen') devices.screen = { x: port('x', MAX_U32, true), y: port('y', MAX_U32, true), r: port('r', MAX_U32, true), g: port('g', MAX_U32, true), b: port('b', MAX_U32, true), emit: port('emit', 1) };
    }
  }
  function ensureFn(context: Context, name: string, root = false, depth = 0): Fn {
    const decl = definitions.get(name) ?? fail(`Unknown function '${name}'`);
    const instanceName = decl.recursive ? `${name}@${depth + 1}` : name;
    const existing = context.functions.get(instanceName); if (existing) return existing;
    const prefix = `${context.name}.${instanceName}`;
    const fn: Fn = { decl, instanceName, depth, context, params: decl.params.map(p => data(`${prefix}.${p}`, context.name, decl.line)), result: data(`${prefix}.result`, context.name, decl.line), code: [], calls: [], root };
    if (root && context.pure) fn.done = data(`${context.name}.done`, context.name, decl.line, 1);
    context.functions.set(instanceName, fn);
    if (root) context.root = fn;
    compileFunction(fn);
    return fn;
  }
  function compileFunction(fn: Fn) {
    const context = fn.context, prefix = `${context.name}.${fn.instanceName}`;
    let env = new Map<string, Binding>(fn.decl.params.map((p, i) => [p, fn.params[i]]));
    const temp = (line: number) => data(`${prefix}.$${++serial}`, context.name, line);
    const emit = (op: Op, line: number, label: string = op): Instruction => {
      if (++instructionCount > 10_000) fail('Compiler safety limit: at most 10,000 lowered instructions', line);
      const i: Instruction = { op, line, label, context, owner: fn };
      const prev = fn.code.at(-1); if (prev && !prev.next) prev.next = i;
      fn.code.push(i); context.code.push(i); return i;
    };
    const alu = (a: number, b = zero, c = zero, target = temp(fn.decl.line), line = fn.decl.line) => {
      Object.assign(emit('alu', line, `write ${m.registers[target].name}`), { a, b, c, target }); return target;
    };
    const copy = (src: number, dst: number, line: number) => alu(src, zero, zero, dst, line);
    const jump = (line: number) => emit('jump', line, 'continue');
    const branch = (value: number, line: number) => Object.assign(emit('branch', line, 'test'), { a: value, b: zero, comparison: '!=' });
    const comparisonBranch = (op: string, a: number, b: number, line: number) => optimizations.comparisonFusion
      ? Object.assign(emit('branch', line, `test ${op}`), { a, b, comparison: op })
      : branch(compare(op, a, b, line), line);
    const lookup = (name: string, line: number): Binding => env.get(name) ?? fail(`Unknown variable '${name}'`, line);
    const scalar = (name: string, line: number) => { const b = lookup(name, line); return typeof b === 'number' ? b : fail(`Array '${name}' needs an index`, line); };
    const zeroTest = (x: number, line: number) => alu(one, zero, x, temp(line), line);
    const compare = (op: string, a: number, b: number, line: number, normalized = true): number => {
      const diff = (x: number, y: number) => alu(x, zero, y, temp(line), line);
      const truth = (x: number) => normalized ? zeroTest(zeroTest(x, line), line) : x;
      if (op === '>') return truth(diff(a, b));
      if (op === '<') return truth(diff(b, a));
      if (op === '<=') return zeroTest(diff(a, b), line);
      if (op === '>=') return zeroTest(diff(b, a), line);
      const distance = alu(diff(a, b), diff(b, a), zero, temp(line), line);
      return op === '==' ? zeroTest(distance, line) : truth(distance);
    };
    function access(name: string, index: Expr, line: number, write?: number): number {
      const slots = lookup(name, line);
      if (!Array.isArray(slots)) fail(`'${name}' is not an array`, line);
      const array = slots as number[];
      if (index.kind === 'number') {
        if (!Number.isInteger(index.value) || index.value < 0 || index.value >= array.length) fail(`Array index outside 0..${array.length - 1}`, line);
        return write === undefined ? array[index.value] : copy(write, array[index.value], line);
      }
      const idx = expression(index), out = write ?? temp(line), exits: Instruction[] = [];
      for (let k = 0; k < array.length; k++) {
        const test = comparisonBranch('==', idx, m.constant(k), line);
        test.yes = jump(line);
        if (write === undefined) copy(array[k], out, line); else copy(write, array[k], line);
        exits.push(jump(line)); test.no = jump(line);
      }
      const fault = data(`${prefix}.arrayBoundsFault.${++serial}`, context.name, line, 1);
      faults.push({ register: fault, message: `Line ${line}: '${name}' index is outside 0..${array.length - 1}` }); copy(one, fault, line);
      const done = jump(line); for (const exit of exits) exit.next = done;
      return out;
    }
    function call(name: string, args: Expr[], line: number): number {
      if (builtinNames.has(name)) {
        const count = (n: number) => { if (args.length !== n) fail(`${name} expects ${n} argument(s)`, line); };
        if (name === 'read') {
          count(0); device('consoleInput', context, line);
          emit('readRequest', line, 'request character');
          const out = temp(line); Object.assign(emit('readReceive', line, 'receive character'), { target: out }); return out;
        }
        if (name === 'halt') { count(0); if (context.pure) fail('Parallel computations cannot halt the whole program', line); emit('halt', line, 'end'); return zero; }
        if (name === 'led') { count(1); led = expression(args[0]); return zero; }
        if (name === 'print') {
          count(1); if (args[0].kind !== 'string') fail('print expects a string literal; use putc for dynamic characters', line);
          device('consoleOutput', context, line);
          for (const char of (args[0] as Expr & { kind: 'string' }).value) {
            copy(m.constant(char.codePointAt(0)!), devices.consoleOutput!.codepoint, line);
            emit('emit', line, `print ${JSON.stringify(char)}`).emit = devices.consoleOutput!.emit;
          }
          return zero;
        }
        if (name === 'putc') {
          count(1); device('consoleOutput', context, line);
          copy(expression(args[0]), devices.consoleOutput!.codepoint, line);
          emit('emit', line, 'emit character').emit = devices.consoleOutput!.emit; return zero;
        }
        count(5); device('screen', context, line);
        const screen = devices.screen!;
        const values = args.map(expression);
        [screen.x, screen.y, screen.r, screen.g, screen.b].forEach((dst, i) => copy(values[i], dst, line));
        emit('emit', line, 'emit pixel').emit = screen.emit; return zero;
      }
      const declaration = definitions.get(name) ?? fail(`Unknown function '${name}'`, line);
      if (args.length !== declaration.params.length) fail(`${name} expects ${declaration.params.length} arguments`, line);
      const nextDepth = declaration.recursive && name === fn.decl.name ? fn.depth + 1 : 0;
      if (nextDepth >= recursionDepth) {
        // The fixed matrix contains a guarded overflow continuation, not a host
        // stack or a compile-time rejection of otherwise valid base cases.
        args.forEach(expression);
        const fault = data(`${prefix}.recursionDepthFault.${++serial}`, context.name, line, 1);
        faults.push({ register: fault, message: `Line ${line}: recursion depth limit ${recursionDepth} exceeded in '${name}'` });
        copy(one, fault, line);
        return zero;
      }
      const callee = ensureFn(context, name, false, nextDepth);
      const values = args.map(expression);
      values.forEach((value, i) => copy(value, callee.params[i], line));
      const site = emit('call', line, `call ${name}`); site.callee = callee;
      site.flag = data(`${prefix}.returnAddress.${++serial}`, context.name, line, 1);
      callee.calls.push(site);
      site.continuation = jump(line);
      return copy(callee.result, temp(line), line);
    }
    function expression(e: Expr): number {
      switch (e.kind) {
        case 'number': return m.constant(e.value);
        case 'variable': return scalar(e.name, e.line);
        case 'index': return access(e.name, e.index, e.line);
        case 'call': return call(e.name, e.args, e.line);
        case 'binary': {
          const a = expression(e.left), b = expression(e.right);
          if (e.op === '+') return alu(a, b, zero, temp(e.line), e.line);
          if (e.op === '-') return alu(a, zero, b, temp(e.line), e.line);
          if (['==', '!=', '<', '<=', '>', '>='].includes(e.op)) return compare(e.op, a, b, e.line);
          return fail(`Unsupported operator '${e.op}'`, e.line);
        }
        default: return fail('Expected a numeric expression', e.line);
      }
    }
    function declare(name: string, value: Binding, line: number) {
      if (env.has(name)) fail(`Duplicate local '${name}'`, line);
      env.set(name, value);
    }
    function condition(e: Expr): Instruction {
      // Predicates feed control directly; only ordinary expression comparisons
      // need a materialized result and the general ALU/writeback path.
      if (e.kind === 'binary' && ['==', '!=', '<', '<=', '>', '>='].includes(e.op)) {
        return comparisonBranch(e.op, expression(e.left), expression(e.right), e.line);
      }
      return branch(expression(e), e.line);
    }
    function terminates(s: Stmt): boolean {
      return s.kind === 'return' || (s.kind === 'expr' && s.expression.kind === 'call' && s.expression.name === 'halt') ||
        (s.kind === 'if' && s.then.length > 0 && s.otherwise.length > 0 && terminates(s.then.at(-1)!) && terminates(s.otherwise.at(-1)!));
    }
    function block(statements: Stmt[], scoped = true) {
      const outer = env; if (scoped) env = new Map(env);
      for (const s of statements) {
        switch (s.kind) {
          case 'let': {
            if (s.size !== undefined) {
              if (!Number.isInteger(s.size) || s.size < 1 || s.size > 256) fail('Fixed arrays must contain 1..256 coordinates', s.line);
              const slots = Array.from({ length: s.size }, (_, i) => data(`${prefix}.${s.name}[${i}]`, context.name, s.line));
              slots.forEach(slot => copy(zero, slot, s.line)); declare(s.name, slots, s.line);
            } else {
              const value = s.value ? expression(s.value) : zero;
              const dst = data(`${prefix}.${s.name}`, context.name, s.line); copy(value, dst, s.line); declare(s.name, dst, s.line);
            }
            break;
          }
          case 'assign': {
            const value = expression(s.value);
            if (s.target.kind === 'variable') copy(value, scalar(s.target.name, s.line), s.line);
            else if (s.target.kind === 'index') access(s.target.name, s.target.index, s.line, value);
            else fail('Assignment requires a variable or array element', s.line);
            break;
          }
          case 'expr': expression(s.expression); break;
          case 'return': {
            const value = expression(s.value);
            if (optimizations.constantReturns && fn.root && !context.pure && m.registers[value].kind === 'constant' && m.registers[value].bound <= HALF) {
              // Main has one activation and returns only once. Its initially
              // zero result can be set on the very same update as end.
              emit('ret', s.line, `return ${fn.decl.name}`).returnValue = m.initial[value];
            } else { copy(value, fn.result, s.line); emit('ret', s.line, `return ${fn.decl.name}`); }
            break;
          }
          case 'if': {
            const test = condition(s.condition);
            test.yes = jump(s.line); block(s.then); const endThen = jump(s.line);
            test.no = jump(s.line); block(s.otherwise); const after = jump(s.line); endThen.next = after;
            break;
          }
          case 'while': {
            const start = jump(s.line), test = condition(s.condition);
            test.yes = jump(s.line); block(s.body); jump(s.line).next = start;
            test.no = jump(s.line); break;
          }
          case 'parallelLet': {
            if (s.names.length !== s.branches.length || !s.names.length) fail('Parallel result names must match branch count', s.line);
            const roots: Fn[] = [];
            for (let b = 0; b < s.branches.length; b++) {
              const expr = s.branches[b]; if (expr.kind !== 'call' || builtinNames.has(expr.name)) fail('A parallel branch must call a regular pure function', s.line);
              const invoke = expr as Expr & { kind: 'call' };
              if (fn.decl.recursive && invoke.name === fn.decl.name) fail('Recursive parallel spawning is not supported; use an ordinary recursive call', s.line);
              const child = newContext(`${context.name}/fork${++serial}.${b}`, true);
              const root = ensureFn(child, invoke.name, true); roots.push(root);
              if (root.params.length !== invoke.args.length) fail(`${invoke.name} expects ${root.params.length} arguments`, s.line);
              invoke.args.map(expression).forEach((v, i) => copy(v, root.params[i], s.line));
              copy(zero, root.done!, s.line);
            }
            const start = emit('fork', s.line, 'fork all branches'); start.branches = roots;
            const ready = m.row(`${context.name}.join.${++serial}`, [...roots.map(r => [r.done!, 1] as [number, number]), [one, -(roots.length - 1)]], 1, context.name);
            const wait = branch(ready, s.line); wait.label = 'wait for all branches'; wait.no = wait;
            wait.yes = jump(s.line);
            roots.forEach((r, i) => { const dst = data(`${prefix}.${s.names[i]}`, context.name, s.line); copy(r.result, dst, s.line); declare(s.names[i], dst, s.line); });
            break;
          }
        }
        if (optimizations.deadCode && terminates(s)) break;
      }
      if (scoped) env = outer;
    }
    jump(fn.decl.line).label = `enter ${fn.instanceName}`;
    block(fn.decl.body, false);
    copy(zero, fn.result, fn.decl.line); emit('ret', fn.decl.line, 'implicit return 0');
  }

  const mainContext = newContext('main', false), main = ensureFn(mainContext, 'main', true);
  if (options.devices?.led !== false && led === undefined) led = main.result;
  const observedLed = led;
  if (options.devices?.led === false) led = undefined;

  // Remove compiler scaffolding before allocating matrix control coordinates.
  // Entering a function is not an operation: calls/forks can activate its first
  // real instruction directly. Source markers stay on those instructions.
  if (optimizations.entryElision) for (const context of contexts) for (const fn of context.functions.values()) {
    if (fn.code[0]?.op === 'jump' && fn.code[0].next) fn.code.shift();
  }
  const entries = new Set(contexts.flatMap(c => [...c.functions.values()].map(fn => fn.code[0])));
  const thread = (destination: Instruction | undefined): Instruction | undefined => {
    if (!optimizations.jumpThreading) return destination;
    const seen = new Set<Instruction>();
    while (destination?.op === 'jump' && !entries.has(destination) && destination.next && !seen.has(destination)) {
      seen.add(destination); destination = destination.next;
    }
    return destination;
  };
  const originalCode = contexts.flatMap(c => c.code);
  for (const instruction of originalCode) {
    instruction.next = thread(instruction.next);
    instruction.yes = thread(instruction.yes);
    instruction.no = thread(instruction.no);
    instruction.continuation = thread(instruction.continuation);
  }
  const reachable = new Set<Instruction>();
  const pending = [main.code[0]];
  while (pending.length) {
    const instruction = pending.pop()!;
    if (reachable.has(instruction)) continue;
    reachable.add(instruction);
    const add = (next: Instruction | undefined) => { if (next) pending.push(next); };
    if (instruction.op === 'branch') { add(instruction.yes); add(instruction.no); }
    else if (instruction.op === 'call') { add(instruction.callee!.code[0]); add(instruction.continuation); }
    else if (instruction.op !== 'ret' && instruction.op !== 'halt') add(instruction.next);
    if (instruction.op === 'fork') instruction.branches!.forEach(fn => add(fn.code[0]));
  }

  // An expression's single-use temporary immediately copied to its destination
  // can write that destination directly. No host execution or constant-input
  // specialization is involved: this is ordinary register/copy coalescing.
  const readCounts = new Map<number, number>();
  const predecessors = new Map<Instruction, Instruction[]>();
  if (!optimizations.deadCode) for (const instruction of originalCode) reachable.add(instruction);
  for (const instruction of reachable) {
    for (const key of ['a', 'b', 'c'] as const) if (instruction[key] !== undefined) {
      readCounts.set(instruction[key]!, (readCounts.get(instruction[key]!) ?? 0) + 1);
    }
    for (const next of [instruction.next, instruction.yes, instruction.no, instruction.continuation]) if (next) {
      const incoming = predecessors.get(next) ?? []; incoming.push(instruction); predecessors.set(next, incoming);
    }
  }
  if (optimizations.copyCoalescing) for (const instruction of reachable) {
    const source = instruction.a;
    if (instruction.op !== 'alu' || source === undefined || instruction.b !== zero || instruction.c !== zero || source === led || readCounts.get(source) !== 1) continue;
    if (!m.registers[source].name.includes('.$')) continue;
    const incoming = predecessors.get(instruction);
    if (incoming?.length !== 1) continue;
    const producer = incoming[0];
    if (!reachable.has(producer) || producer.op !== 'alu' || producer.target !== source || producer.next !== instruction) continue;
    producer.target = instruction.target;
    producer.label = instruction.label;
    producer.next = instruction.next;
    reachable.delete(instruction);
  }
  for (const context of contexts) {
    context.code = context.code.filter(i => reachable.has(i));
    for (const [name, fn] of context.functions) {
      fn.code = fn.code.filter(i => reachable.has(i));
      fn.calls = fn.calls.filter(i => reachable.has(i));
      if (!fn.code.length) context.functions.delete(name);
    }
  }
  for (let index = contexts.length - 1; index >= 0; index--) if (!contexts[index].code.length) contexts.splice(index, 1);

  // Generated expression temporaries are not source variables. Reuse their
  // physical coordinates when CFG liveness proves they cannot overlap. Each
  // function in each execution context gets its own scratch bank: values live
  // across calls and concurrently running branches therefore remain isolated.
  const observed = new Set<number>([end, ...faults.map(fault => fault.register)]);
  if (observedLed !== undefined) observed.add(observedLed);
  if (led !== undefined) observed.add(led);
  for (const context of contexts) for (const fn of context.functions.values()) {
    fn.params.forEach(parameter => observed.add(parameter));
    observed.add(fn.result);
    if (fn.done !== undefined) observed.add(fn.done);
  }
  if (optimizations.scratchReuse) for (const context of contexts) for (const fn of context.functions.values()) {
    const prefix = `${context.name}.${fn.instanceName}`;
    const candidates = new Set<number>();
    for (const instruction of fn.code) for (const key of ['a', 'b', 'c', 'target'] as const) {
      const id = instruction[key];
      if (id !== undefined && !observed.has(id) && m.registers[id].kind === 'data' && m.registers[id].bound === MAX_U32 && m.registers[id].name.startsWith(`${prefix}.$`)) candidates.add(id);
    }
    if (candidates.size < 2) continue;
    const instructions = new Set(fn.code);
    const successors = (instruction: Instruction): Instruction[] => {
      const next = instruction.op === 'branch' ? [instruction.yes, instruction.no]
        : instruction.op === 'call' ? [instruction.continuation]
          : instruction.op === 'ret' || instruction.op === 'halt' ? [] : [instruction.next];
      return next.filter((value): value is Instruction => value !== undefined && instructions.has(value));
    };
    const uses = new Map(fn.code.map(instruction => [instruction, new Set([instruction.a, instruction.b, instruction.c].filter((id): id is number => id !== undefined && candidates.has(id)))]));
    const liveIn = new Map(fn.code.map(instruction => [instruction, new Set<number>()]));
    const liveOut = new Map(fn.code.map(instruction => [instruction, new Set<number>()]));
    let changed: boolean;
    do {
      changed = false;
      for (let index = fn.code.length - 1; index >= 0; index--) {
        const instruction = fn.code[index];
        const outgoing = new Set<number>();
        for (const next of successors(instruction)) for (const id of liveIn.get(next)!) outgoing.add(id);
        const incoming = new Set(uses.get(instruction));
        for (const id of outgoing) if (id !== instruction.target) incoming.add(id);
        const previous = liveIn.get(instruction)!;
        if (incoming.size !== previous.size || [...incoming].some(id => !previous.has(id))) changed = true;
        liveIn.set(instruction, incoming);
        liveOut.set(instruction, outgoing);
      }
    } while (changed);
    const interference = new Map([...candidates].map(id => [id, new Set<number>()]));
    const connect = (left: number, right: number) => {
      if (left !== right) { interference.get(left)!.add(right); interference.get(right)!.add(left); }
    };
    const clique = (values: Set<number>) => {
      const ids = [...values];
      for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) connect(ids[i], ids[j]);
    };
    for (const instruction of fn.code) {
      clique(liveIn.get(instruction)!);
      clique(liveOut.get(instruction)!);
      if (instruction.target !== undefined && candidates.has(instruction.target)) {
        for (const id of liveOut.get(instruction)!) connect(instruction.target, id);
      }
    }
    // Deterministic saturation-degree coloring generally needs only one or two
    // words for sequential expressions, without promising globally minimal W.
    const colors = new Map<number, number>();
    const neighborColors = new Map([...candidates].map(id => [id, new Set<number>()]));
    const remaining = new Set(candidates);
    while (remaining.size) {
      let selected = -1;
      for (const id of remaining) {
        if (selected === -1 || neighborColors.get(id)!.size > neighborColors.get(selected)!.size
          || (neighborColors.get(id)!.size === neighborColors.get(selected)!.size && interference.get(id)!.size > interference.get(selected)!.size)
          || (neighborColors.get(id)!.size === neighborColors.get(selected)!.size && interference.get(id)!.size === interference.get(selected)!.size && id < selected)) selected = id;
      }
      const forbidden = neighborColors.get(selected)!;
      let color = 0;
      while (forbidden.has(color)) color++;
      colors.set(selected, color);
      remaining.delete(selected);
      for (const neighbor of interference.get(selected)!) neighborColors.get(neighbor)!.add(color);
    }
    const representatives = new Map<number, number>();
    for (const id of [...candidates].sort((a, b) => a - b)) {
      const color = colors.get(id)!;
      if (!representatives.has(color)) {
        representatives.set(color, id);
        m.registers[id].name = `${prefix}.scratch.slot${color + 1}`;
        m.registers[id].line = undefined;
      }
    }
    for (const instruction of fn.code) {
      for (const key of ['a', 'b', 'c', 'target'] as const) {
        const id = instruction[key];
        if (id !== undefined && colors.has(id)) instruction[key] = representatives.get(colors.get(id)!)!;
      }
      if (instruction.op === 'alu') instruction.label = `write ${m.registers[instruction.target!].name}`;
    }
  }
  // In-place affine increments/decrements need no operand selection or ALU
  // writeback circuitry: the instruction's existing dispatch pulse can update
  // the retained coordinate directly, at the same commit boundary as before.
  if (optimizations.directDelta) for (const context of contexts) for (const instruction of context.code) {
    if (instruction.op !== 'alu') continue;
    const constantValue = (id: number | undefined): number | undefined => id !== undefined && m.registers[id].kind === 'constant' && m.registers[id].bound <= HALF ? m.initial[id] : undefined;
    if (instruction.c === zero) {
      if (instruction.a === instruction.target) instruction.directDelta = constantValue(instruction.b);
      else if (instruction.b === instruction.target) instruction.directDelta = constantValue(instruction.a);
    } else if (instruction.a === instruction.target && instruction.b === zero) {
      const amount = constantValue(instruction.c);
      if (amount !== undefined) instruction.directDelta = -amount;
    }
  }
  // Constant-only replacement writers share just the old-value gate. Their
  // dispatch pulses supply the new value without passing through the ALU.
  if (optimizations.constantWrites) for (const context of contexts) {
    const targets = new Map<number, Instruction[]>();
    for (const i of context.code) if (i.target !== undefined && i.directDelta === undefined) {
      const list = targets.get(i.target) ?? []; list.push(i); targets.set(i.target, list);
    }
    for (const writes of targets.values()) {
      if (writes.every(i => i.op === 'alu' && i.b === zero && i.c === zero && i.a !== undefined && m.registers[i.a].kind === 'constant')) {
        for (const i of writes) i.directSet = m.initial[i.a!];
      }
    }
  }
  const finish = (allCode: Instruction[]) => {
    const artifact: Artifact = {
      version: 1, name: options.name ?? 'Matrix program', source,
      rows: m.rows.map(row => ({ cols: [...row.keys()], weights: [...row.values()] })),
      registers: m.registers, initial: m.initial,
      inputs: Object.fromEntries(main.decl.params.map((name, i) => [name, main.params[i]])),
      result: main.result, end, led, devices, faults,
      markers: allCode.filter(i => i.pc !== undefined).map(i => ({ register: i.pc!, line: i.line, label: i.label, context: i.context.name })),
      stats: { instructions: allCode.length, contexts: contexts.length, functionInstances: contexts.flatMap(c => [...c.functions.keys()].map(n => `${c.name}.${n}`)) },
    };
    return optimizations.prune ? pruneArtifact(artifact, observedLed === undefined ? [] : [observedLed]) : artifact;
  };
  if (optimizations.counterMachine && contexts.length === 1 && mainContext.functions.size === 1 && !Object.keys(devices).length && !faults.length
    && lowerCounterMachine(m, main.code, end, main.result, zero, optimizations, main.params)) return finish(main.code);

  const clock = Array.from({ length: 11 }, (_, i) => m.add(`clock.${i}`, 'control', 1, i === 0 ? 1 : 0));
  clock.forEach((id, i) => m.terms(id, [[clock[(i + 10) % 11], 1]]));
  const allCode = contexts.flatMap(c => c.code);
  if (devices.consoleOutput && !allCode.some(i => i.op === 'emit' && i.emit === devices.consoleOutput!.emit)) delete devices.consoleOutput;
  if (devices.screen && !allCode.some(i => i.op === 'emit' && i.emit === devices.screen!.emit)) delete devices.screen;
  if (devices.consoleInput && !allCode.some(i => i.op === 'readRequest')) delete devices.consoleInput;
  for (const [index, i] of allCode.entries()) {
    i.pc = m.add(`${i.context.name}.pc.${index}.${i.label}`, 'control', 1, i === main.code[0] ? 1 : 0, i.context.name, i.line); m.hold(i.pc);
    // PCs remain stable for the entire 11-update instruction period. Sample
    // the shared clock directly instead of allocating nine delay coordinates
    // for every instruction's execution pulse.
    if (!optimizations.clockSampling) {
      const execute = m.row(`instruction.${i.pc}.execute`, [[i.pc, 1], [clock[0], 1], [one, -1]], 1, i.context.name);
      if (i.op === 'branch' || (i.op === 'ret' && !i.owner!.root)) i.preDispatch = m.delay(execute, 8, `instruction.${i.pc}.prepare`, 1, i.context.name);
      if (i.op !== 'branch') {
        i.dispatch = m.delay(execute, 9, `instruction.${i.pc}.phase`, 1, i.context.name);
        m.terms(i.pc, [[i.dispatch, -1]]);
      }
      continue;
    }
    if (i.op === 'ret' && !i.owner!.root) {
      i.preDispatch = m.row(`instruction.${i.pc}.prepareDispatch`, [[i.pc, 1], [clock[8], 1], [one, -1]], 1, i.context.name);
    }
    if (i.op !== 'branch') {
      i.dispatch = m.row(`instruction.${i.pc}.dispatch`, [[i.pc, 1], [clock[9], 1], [one, -1]], 1, i.context.name);
      m.terms(i.pc, [[i.dispatch, -1]]);
    }
  }
  function route(pulse: number, destination: Instruction | undefined) {
    if (!destination) throw new Error('Internal error: missing control destination');
    m.terms(destination.pc!, [[pulse, 1]]);
  }
  for (const context of contexts) {
    // These continuously evaluated predicates are safe even while their branch
    // is inactive. Data commits at phase zero; at most two comparator updates
    // settle well before control samples them at phase nine.
    const differences = new Map<string, number>(), zeroTests = new Map<number, number>(), equalities = new Map<string, number>();
    const difference = (a: number, b: number): number => {
      if (a === b || a === zero) return zero;
      if (b === zero) return a;
      const key = `${a}:${b}`;
      let result = optimizations.predicateSharing ? differences.get(key) : undefined;
      if (result === undefined) { result = m.row(`${context.name}.compare.difference.${a}.${b}`, [[a, 1], [b, -1]], MAX_U32, context.name); differences.set(key, result); }
      return result;
    };
    const isZero = (a: number): number => {
      if (a === zero) return one;
      let result = optimizations.predicateSharing ? zeroTests.get(a) : undefined;
      if (result === undefined) { result = m.row(`${context.name}.compare.zero.${a}`, [[one, 1], [a, -1]], 1, context.name); zeroTests.set(a, result); }
      return result;
    };
    const predicate = (i: Instruction): { value: number; invert: boolean } => {
      const a = i.a!, b = i.b!, op = i.comparison!;
      if (op === '==' || op === '!=') {
        if (b === zero && m.registers[a].bound <= 1) return { value: a, invert: op === '==' };
        const key = `${Math.min(a, b)}:${Math.max(a, b)}`;
        let equal = optimizations.predicateSharing ? equalities.get(key) : undefined;
        if (equal === undefined) {
          const p = difference(a, b), q = difference(b, a);
          equal = p === zero ? isZero(q) : q === zero ? isZero(p) : m.row(`${context.name}.compare.equal.${key}`, [[one, 1], [p, -1], [q, -1]], 1, context.name);
          equalities.set(key, equal);
        }
        return { value: equal, invert: op === '!=' };
      }
      return { value: isZero(op === '<' || op === '>=' ? difference(b, a) : difference(a, b)), invert: op === '<' || op === '>' };
    };
    const operands: number[] = [];
    for (const key of ['a', 'b', 'c'] as const) {
      const readers = new Map<number, number[]>();
      for (const i of context.code) if (i.op !== 'branch' && i.directDelta === undefined && i.directSet === undefined && i[key] !== undefined && i[key] !== zero) {
        const list = readers.get(i[key]!) ?? []; list.push(i.pc!); readers.set(i[key]!, list);
      }
      const selected = [...readers].map(([value, pcs]) => {
        const register = m.registers[value];
        if (optimizations.constantOperands && register.kind === 'constant' && register.bound <= HALF) {
          // Constants are immutable: sample later and scale the selector in
          // one row, producing the same operand pulse at update five.
          const amount = register.bound;
          return m.row(`${context.name}.read.${key}.${value}.constant`, [...pcs.map(pc => [pc, amount] as [number, number]), [clock[4], amount], [one, -amount]], amount, context.name);
        }
        const selector = m.row(`${context.name}.read.${key}.${value}`, [...pcs.map(pc => [pc, 1] as [number, number]), [clock[1], 1], [one, -1]], 1, context.name);
        return m.gate(value, selector, `${context.name}.read.${key}.${value}`, context.name);
      });
      operands.push(selected.length ? m.row(`${context.name}.operand.${key}`, selected.map(v => [v, 1]), MAX_U32, context.name) : zero);
    }
    const aluTerms: Terms = [[operands[0], 1], [operands[1], 1], [operands[2], -1]];
    if (devices.consoleInput && context === mainContext) {
      const input = devices.consoleInput;
      const wordLo = m.row('input.wordLo', [[input.codepoint, 1], [input.eof, HALF]]);
      const wordHi = m.row('input.wordHi', [[input.eof, HALF]]);
      const eofDelay = m.delay(input.eof, 1, 'input.eofDelay');
      const word = m.row('input.word', [[wordLo, 1], [wordHi, 1], [eofDelay, 1]]);
      aluTerms.push([m.delay(word, 3, 'input.receive', MAX_U32), 1]);
    }
    const alu = m.row(`${context.name}.alu`, aluTerms, MAX_U32, context.name);
    const writers = new Map<number, Instruction[]>();
    for (const i of context.code) if (i.directDelta === undefined && i.target !== undefined) {
      const list = writers.get(i.target) ?? []; list.push(i); writers.set(i.target, list);
    }
    for (const [target, writes] of writers) {
      const aligned = m.row(`${context.name}.write.${target}.select`, [...writes.map(i => [i.pc!, 1] as [number, number]), [clock[6], 1], [one, -1]], 1, context.name);
      const old = m.gate(target, aligned, `${context.name}.write.${target}.old`, context.name);
      m.terms(target, [[old, -1]]);
      if (writes[0].directSet !== undefined) {
        for (const i of writes) {
          let remaining = i.directSet!, pulse = i.dispatch!;
          while (remaining > 0) {
            const chunk = Math.min(remaining, HALF);
            m.terms(target, [[pulse, chunk]]);
            remaining -= chunk;
            // Duplicate the same predicate, not a delayed pulse: all pieces
            // of a full-u32 constant must arrive at the same commit boundary.
            if (remaining) pulse = m.row(`instruction.${i.pc}.constant.${remaining}`, [[i.pc!, 1], [clock[9], 1], [one, -1]], 1, context.name);
          }
        }
      } else {
        const value = m.gate(alu, aligned, `${context.name}.write.${target}.new`, context.name);
        m.terms(target, [[value, 1]]);
      }
    }
    for (const i of context.code) {
      if (i.op === 'branch') {
        const { value, invert } = predicate(i);
        const selector: Terms = optimizations.clockSampling ? [[i.pc!, 1], [clock[9], 1], [one, -1]] : [[i.preDispatch!, 1]];
        const on = m.row(`branch.${i.pc}.on`, [...selector, [value, 1], [one, -1]], 1, context.name);
        const off = m.row(`branch.${i.pc}.off`, [...selector, [value, -1]], 1, context.name);
        const [yes, no] = invert ? [off, on] : [on, off];
        m.terms(i.pc!, [[yes, -1], [no, -1]]);
        route(yes, i.yes); route(no, i.no);
      } else if (i.op === 'call') {
        route(i.dispatch!, i.callee!.code[0]); m.terms(i.flag!, [[i.dispatch!, 1]]);
      } else if (i.op === 'ret') {
        const fn = i.owner!;
        if (fn.root) {
          m.terms(fn.done ?? end, [[i.dispatch!, 1]]);
          if (i.returnValue) m.terms(fn.result, [[i.dispatch!, i.returnValue]]);
        }
        else for (const call of fn.calls) {
          const returning = m.row(`return.${i.pc}.to.${call.pc}`, [[i.preDispatch!, 1], [call.flag!, 1], [one, -1]], 1, context.name);
          route(returning, call.continuation); m.terms(call.flag!, [[returning, -1]]);
        }
      } else if (i.op === 'halt') m.terms(end, [[i.dispatch!, 1]]);
      else {
        route(i.dispatch!, i.next);
        if (i.directDelta !== undefined) m.terms(i.target!, [[i.dispatch!, i.directDelta]]);
        if (i.op === 'emit') m.terms(i.emit!, [[i.dispatch!, 1]]);
        if (i.op === 'readRequest') m.terms(devices.consoleInput!.request, [[i.dispatch!, 1]]);
        if (i.op === 'fork') for (const root of i.branches!) route(i.dispatch!, root.code[0]);
      }
    }
  }
  return finish(allCode);
}
