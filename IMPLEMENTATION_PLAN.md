# Implementation Plan

This is a proposed implementation sequence for the design in [DESIGN.md](DESIGN.md), [IO.md](IO.md), and [RUNTIME.md](RUNTIME.md). The repository currently contains documentation only. This plan does not claim that its milestones, tests, or benchmarks have been implemented.

## 1. First usable result

The first usable application should let someone edit a small parity program, enter a number, compile it into a fixed matrix, and execute it in the browser. The page shows named registers, the current source instruction, an LED bound to the result, and the end gate. No console or screen is linked into that program.

This is the first complete path through the product:

```text
Source -> parser -> checked program -> control/register IR -> fixed sparse W
                                                               |
                                         initial state -> repeated ReLU updates
                                                               |
                                              register view, LED, end
```

An earlier foundation change establishes the artifact format and checks matrix execution on small hand-authored fixtures. Subsequent milestones extend the same compiler and runtime contracts; they do not replace matrix execution with a source-language interpreter.

## 2. Design constraints to preserve

- State coordinates are unsigned 32-bit numbers. Weights are signed 32-bit numbers. The executor uses exact signed 64-bit accumulation under verified bounds, applies ReLU, and faults on an out-of-range stored result.
- Every artifact identifies an end coordinate. Any nonzero value stops execution after recording the final tick's output events.
- The LED observes an existing coordinate's nonzeroness and adds no matrix state.
- Console output, console input, and the screen are independently optional. Disabled or unused peripherals and their helper code add no matrix coordinates or entries.
- The screen has exactly six interface coordinates: `X, Y, R, G, B, emission_flag`. The browser retains the image. There is no matrix framebuffer or `present` gate.
- Regular function bodies are shared across call sites and cannot participate in recursion. Explicit `rec fn` functions use bounded frames and also share their compiled bodies.
- Inputs after initialization enter only through the defined blocking-read protocol and fixed input matrix `B`. The host does not patch program registers to perform arithmetic or control flow.
- A source instruction may take several matrix updates. The compiler must preserve dependencies, simultaneous assignment, register lifetime, and observable event order.

## 3. Proposed implementation choices

Use TypeScript for parsing, semantic analysis, compiler IR, artifact metadata, the exact reference executor, and the UI. Use a small Rust module for the later WebAssembly execution backend. Rust's `wasm32-unknown-unknown` target is intended for minimal WebAssembly environments, including browser/JavaScript use. [Rust target documentation](https://doc.rust-lang.org/rustc/platform-support/wasm32-unknown-unknown.html).

For parsing, implement a small typed, project-local Parsec-style combinator layer supporting `map`, `chain`, choice, sequencing, repetition, delayed recursion, labels, and source spans. Keep it specific to this grammar rather than building a general parsing framework. Parsimmon matches the requested style, but its repository currently marks it unmaintained, so it is not the proposed dependency. [Parsimmon repository](https://github.com/jneen/parsimmon).

Use Vite to develop/build the TypeScript browser page. Begin with a text editor area, ordinary DOM controls, and canvas/SVG views; do not make the first compiler milestone depend on choosing a large UI framework or editor component. Vite documents TypeScript handling, WebAssembly loading, and worker integration. The precise Rust/WASM packaging path should be smoke-tested when that backend is introduced. [Vite features](https://vite.dev/guide/features.html).

Keep the first repository structure small:

```text
src/
  artifact/             Shared formats, validation, source maps
  parser/               Typed combinators, grammar, syntax tree
  compiler/             Semantics, control/register IR, lowering, allocation
  runtime/              Exact reference executor, device/event contracts
  web/                  Editor, worker coordination, visualizations, devices
crates/
  runtime-wasm/         Rust sparse executor, added at the WASM milestone
examples/               Source programs and a few hand-authored matrix fixtures
tests/                  Semantic, compiler, differential, browser checks
bench/                  Representative execution benchmarks
```

Create directories when they acquire real code. Add locked dependencies, scripts for development/type-checking/testing/building, and CI as part of the foundation. Do not introduce a package-publishing or plugin system for the initial implementation.

## 4. Milestones and completion criteria

### M0. Establish the artifact and exact execution contract

Define a versioned compiled artifact: dimension, CSR coefficients/indices/offsets, optional `B`, initial-state template, input/result bindings, required end index, optional LED/device manifest, row bounds, and source/register metadata. Validate lengths, indices, numeric ranges, device layouts, and the accumulator certificate at the artifact boundary.

Implement a TypeScript reference executor with `Uint32Array` state and `BigInt` products/sums. BigInt is internal to this correctness reference; all committed coordinates still obey the agreed 32-bit limits. Use separate current/next state buffers and atomic commit on a successful complete update.

Support one update, a bounded run, end detection, initial-input assignment, numeric faults, and cancellation between batches. Reserve an event/input interface without allocating absent devices into artifacts. Source-map inspection should work even for the first hand-authored fixtures.

Done when small fixtures establish simultaneous updates, negative ReLU behavior, cancellation of large terms, checked overflow, initial nonzero end, and immediate termination on end. A hand-authored parity fixture produces the expected result without peripheral storage. None of these checks is a performance benchmark.

### M1. Prove the compiler's primitive lowering

Build a small control/register IR and a row-construction API. Implement the actual matrix circuits for retention, constants, bounded transfers, counter increments/decrements, comparisons, condition-controlled updates, transitions, and end. Keep scheduling explicit, including preparation and commit phases.

Resolve the hardest arithmetic issues here: signed coefficient limits for full-range `nat`, accumulator bounds, and preventing inactive branches from modifying registers or producing spurious overflows. A high-level conditional assignment is not permission to multiply two changing coordinates inside one row.

Done when independently specified IR transitions agree with compiled matrix execution at instruction boundaries for focused examples and range boundaries. Include an atomic swap, both paths of a branch, a loop, a full-range copy, and preservation of unrelated registers. Record temporary-register counts and update costs for each implemented primitive.

If a primitive only supports a narrower proved range, make that limitation explicit in compilation diagnostics until general lowering is available. Do not silently narrow or wrap values.

### M2. Compile and visualize a source-level parity checker

Finalize a small grammar using the existing illustrative syntax as the starting point: one `main` function, typed parameters/result, literals, locals, assignments, affine/ReLU expressions, comparisons, `if`/`else`, `while`, `parallel`, return, and halt. Specify operator precedence and the meaning of natural-number subtraction. Arbitrary multiplication and division are not required for this milestone.

The parser attaches source spans. Semantic analysis resolves names and checks types before lowering. Add useful syntax/type errors, including integer literals outside the supported range. The parser must handle consuming versus non-consuming failures and prevent repetition of an empty parser from looping forever.

Build a thin browser page with source editing, numeric input, Compile, Run, Pause, Reset, matrix-update stepping, instruction stepping, a register table, an LED/result view, and an end indicator. Display matrix dimension and nonzero count. For small matrices, show a coefficient grid; larger ones need a bounded/virtualized or sparse view.

Keep runs in bounded batches so cancellation and page interaction remain responsive. Source highlighting comes from compiler metadata, not guessed mappings from matrix rows.

Done when the parity example compiles and executes entirely through the generated recurrence for both even and odd inputs. Its result drives the LED, both outcomes terminate, and toggling the LED changes no matrix coefficients or dimensions. Compilation diagnostics point to source text. This is the first usable demo.

### M3. Add shared regular functions

Extend the parser and semantic analysis for multiple functions and calls. Build the call graph and reject direct or indirect recursion in regular functions. Compile one body per regular function with static parameter/local/result storage and explicit return-location routing.

Implement argument evaluation, pass-by-value transfers, nested calls, result handling, and local reinitialization. Preserve caller values that must survive a call. Start with sharing as the only call strategy; small-function inlining can be considered after the shared convention works.

Done when one parity helper is called from two source locations, including a repeated call inside a loop, and the artifact contains one shared body. Add nested helper calls, reused locals, return-to-correct-site checks, and rejection of recursive cycles. The inspector can step into or over a call using the generated control metadata.

### M4. Add independently optional I/O

Implement capability reachability/linking before final allocation. First add character output, then blocking character input, then the six-coordinate screen port. Use the same shared-function machinery for device helpers, including pixel drawing loops and literal-string output.

Implement per-tick events, reusable payload latches, input suspension, EOF, immutable event payloads, retained host screen memory, and deterministic event order. A same-tick final pixel/character is applied before end; an input request cannot consume a character after end.

Add compiler/UI toggles for console input, console output, and the display. Check disabled-device calls at compile time, and remove enabled-but-unused capabilities as well as unreachable library helpers. The LED remains a read-only binding rather than a linked peripheral.

Done when a character echo program and a pixel-drawing program work in the browser. A diagonal uses the same six screen positions for every pixel. A parity program's executable artifact is unchanged by merely allowing unused devices; it has no `B`, console ports, screen port, or device-specific phases. Input-only and output-only artifacts remain independent.

Verify consecutive emission ticks, reused payloads, final events with end, pixel persistence, edge coordinates/colors, invalid arguments, suspension/resume, and a replayable sequence of delivered input and output events. Full debugger time-travel UI can follow later.

### M5. Add the WebAssembly execution backend

Implement the same artifact contract in Rust and compile it to WebAssembly. Validate imported artifacts, use sparse rows and double-buffered state, widen weights/state correctly, and use the established bounds for signed 64-bit accumulation. Keep all committed-state and fault semantics identical to the reference executor.

Run batches inside WASM, inspecting gates after every committed update. Return at end, faults, input boundaries, breakpoints/budgets, or event-buffer limits. Transfer batched character/pixel events to the UI without losing ticks. Run the backend in a browser worker and keep matrix/state allocations in WASM memory across batches.

Done when WASM and the reference backend agree on every committed state and event for the milestone examples and generated small valid artifacts, including overflow and input-boundary cases. Compare both at the matrix-update level, not only final answers. Add a browser smoke test for loading and running the actual WASM module.

Measure startup, committed updates per second, memory, and interaction latency on representative matrices. Optimize only after correctness matches; SIMD is a later measured optimization, not an initial requirement. The source numeric model remains 32-bit.

### M6. Add explicitly recursive functions

Enable `rec fn` and mutual recursion under the rule that every function in a call-graph cycle must be declared recursive. Keep regular functions on their existing static-storage convention.

Define bounded frame layout, capacity, return locations, saved live locals/intermediates, and an explicit stack-overflow outcome. Compile push, restore, and return as matrix operations. Frame selection and transfers must not be performed secretly by the host runtime.

Done when a small recursive sum/Fibonacci example and a mutually recursive example execute correctly, including a recursive call that reads or writes a character. Check stack limits, preserved locals, correct return destinations, and that each recursive function still has one shared body. Validate both runtimes. General unbounded recursion and tail-call optimization are outside this milestone.

### M7. Make the playground useful for exploration

Improve source editing, the sparse matrix view, register grouping, call/stack inspection, device panels, stepping, and example selection. Make the end state, pending input, numeric fault, budget pause, and stack overflow visibly distinct.

Add artifact/source export and import, checkpoint/replay controls, and useful size/cost reports: matrix dimension, nonzero weights, persistent/temporary/control/device coordinates, and updates per source instruction or function call. Checkpoint restoration includes the input queue and retained host screen, not just the matrix state.

Recreate the primality example in source and compare its answers with the original reference; a newly compiled implementation need not have the original 24 coordinates or exact tick counts. Add device-free parity, shared calls, recursion, echo, and pixel drawing to the example gallery.

Done when a user can understand a program's generated matrix, inspect its execution, reproduce an input-driven run, and see the size effect of enabling a used device. Finish build/CI/browser checks and document local usage. Public deployment is a separate task from completing a working local playground.

## 5. How to start the first implementation change

The first implementation change should complete M0 and begin M1 with a narrowly chosen parity fixture. Its deliverables are:

1. TypeScript development/test/build scaffolding and CI checks.
2. The versioned sparse artifact interfaces and validator.
3. Exact reference stepping with atomic commits, numeric faults, end, and LED metadata.
4. A small named-row builder and hand-authored parity fixture.
5. Focused tests proving the actual recurrence and termination behavior.

The next change completes enough lowering and parsing for M2's browser demo. Do not start by implementing the whole language, every device, recursive frames, and WASM in a single change. Each milestone should leave a runnable, inspectable result for the next one.

## 6. Scope held for later

Defer dynamic arrays/heap allocation, arbitrary-precision program values, 64-bit source types, concurrency, nonblocking input, pixel readback, atomic frame presentation, general file/network devices, aggressive register sharing/inlining, SIMD, and a plugin ecosystem. These do not block the agreed language and device model.

No schedule or speedup is promised before the first implementation exposes real compiler/runtime costs. The primary progress measures are working examples, exactness, explainable generated state, shared code, and absence of unused-device overhead.
