# Implementation Plan

This is the implementation roadmap for [DESIGN.md](DESIGN.md), [IO.md](IO.md), [RUNTIME.md](RUNTIME.md), and [DEBUGGER.md](DEBUGGER.md). A runnable first version now includes the requested programs, shared functions, structured parallel execution, optional devices, exact WASM, and a matrix/vector phase debugger. See [IMPLEMENTATION.md](IMPLEMENTATION.md) for verified scope and remaining work; not every milestone criterion below is complete.

## 1. First usable result

The first usable application should let someone edit a small parity program, enter a number, compile it into a fixed matrix, and execute it in the browser. Education is the primary goal: the page lets the user inspect multiplication, exact output before ReLU, output after ReLU, and commit as separate phases. It shows named registers, the current source instruction, row contributions, an LED bound to the result, and the end gate. No console or screen is linked into that program.

This is the first complete path through the product:

```text
Source
  -> Chevrotain lexer/parser and CST visitor
  -> typed AST and checked control/register IR
  -> fixed sparse W + initial state
  -> inspect W*x before ReLU -> inspect ReLU result -> commit next state
  -> row explanations, source/register view, LED, end, history
```

An earlier foundation change establishes the artifact format and checks matrix execution on small hand-authored fixtures. Subsequent milestones extend the same compiler and runtime contracts; they do not replace matrix execution with a source-language interpreter.

## 2. Design constraints to preserve

- State coordinates are unsigned 32-bit numbers. Weights are signed 32-bit numbers. The executor uses exact signed 64-bit accumulation under verified bounds, applies ReLU, and faults on an out-of-range stored result.
- Every artifact identifies an end coordinate. Any nonzero value stops execution after recording the final tick's output events.
- The LED observes an existing coordinate's nonzeroness and adds no matrix state.
- Console output, console input, and the screen are independently optional. Disabled or unused peripherals and their helper code add no matrix coordinates or entries.
- The screen has exactly six interface coordinates: `X, Y, R, G, B, emission_flag`. The browser retains the image. There is no matrix framebuffer or `present` gate.
- Structured parallel computation is a core feature: branches advance within one recurrence, own separate mutable state, retain completed results, and join before the parent continues. This is distinct from atomic parallel assignment.
- Regular function bodies are shared across sequential call sites within an execution context and cannot participate in recursion. Parallel contexts may require separate function circuitry. Explicit `rec fn` functions share their body within each context and use that context's bounded stack.
- Initial parallel branches have no console/screen I/O or global halt, directly or through helpers. Perform those effects before a fork or after its join. LED observation remains metadata and is allowed.
- Inputs after initialization enter only through the defined blocking-read protocol and fixed input matrix `B`. The host does not patch program registers to perform arithmetic or control flow.
- A source instruction may take several matrix updates. The compiler must preserve dependencies, simultaneous assignment, register lifetime, and observable event order.
- The browser must expose exact pre-ReLU and post-ReLU values, explain selected rows from their actual inputs/weights, and track all active parallel contexts. Debug previews and history add runtime memory, not matrix coordinates, and must not emit I/O before commit.

## 3. Proposed implementation choices

Use TypeScript for parsing, semantic analysis, compiler IR, artifact metadata, the exact reference executor, and the UI. Use a small Rust module for the later WebAssembly execution backend. Rust's `wasm32-unknown-unknown` target is intended for minimal WebAssembly environments, including browser/JavaScript use. [Rust target documentation](https://doc.rust-lang.org/rustc/platform-support/wasm32-unknown-unknown.html).

Chevrotain is the selected lexer/parser toolkit. Define tokens and grammar rules directly in TypeScript using its lexer and `CstParser`, then use a CST visitor to construct our own typed AST with source spans. Keep type checking and matrix generation in later stages. This supersedes the earlier plan to implement project-local parser combinators. [Chevrotain lexer tutorial](https://chevrotain.io/docs/tutorial/step1_lexing.html), [parser tutorial](https://chevrotain.io/docs/tutorial/step2_parsing.html), and [CST visitor tutorial](https://chevrotain.io/docs/tutorial/step3a_adding_actions_visitor.html).

Use Vite to develop/build the TypeScript browser page. Begin with a text editor area, ordinary DOM controls, and canvas/SVG views; do not make the first compiler milestone depend on choosing a large UI framework or editor component. Vite documents TypeScript handling, WebAssembly loading, and worker integration. The precise Rust/WASM packaging path should be smoke-tested when that backend is introduced. [Vite features](https://vite.dev/guide/features.html).

Keep the first repository structure small:

```text
src/
  artifact/             Shared formats, validation, source maps
  parser/               Chevrotain tokens/rules, CST visitor, typed AST
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

Define a versioned compiled artifact: dimension, CSR coefficients/indices/offsets, optional `B`, initial-state template, input/result bindings, required end index, optional LED/device manifest, row bounds, and source/register metadata. Include optional context/group, local-completion, and join metadata without allocating parallel hardware for sequential programs. Validate lengths, indices, numeric ranges, device layouts, and the accumulator certificate at the artifact boundary.

Implement a TypeScript reference executor with `Uint32Array` state and `BigInt` products/sums. BigInt is internal to this correctness reference; all committed coordinates still obey the agreed 32-bit limits. Expose prepare/multiply, rectify/validate, and commit phases, retaining exact signed preactivations and wide candidates for inspection. Use separate current/next state buffers and atomic commit on a successful complete update. Complete-update stepping composes the same phases.

Support one update, a bounded run, end detection, initial-input assignment, numeric faults, and cancellation between batches. Reserve an event/input interface without allocating absent devices into artifacts. Source-map inspection should work even for the first hand-authored fixtures.

Done when small fixtures establish simultaneous updates, exact pre/post-ReLU views, cancellation of large terms, inspectable checked overflow, initial nonzero end, and immediate termination on end. Preview phases must leave the tick and committed state unchanged, and phase-stepped execution must agree with complete updates. A hand-authored parity fixture produces the expected result without peripheral storage. None of these checks is a performance benchmark.

### M1. Prove the compiler's primitive lowering

Build a small control/register IR and a row-construction API. Implement the actual matrix circuits for retention, constants, bounded transfers, counter increments/decrements, comparisons, condition-controlled updates, transitions, and end. Plan context ownership and fork/join as IR concepts from the start, including local completion and holding finished branches. Keep scheduling explicit, including preparation and commit phases.

Resolve the hardest arithmetic issues here: signed coefficient limits for full-range `nat`, accumulator bounds, and preventing inactive branches from modifying registers or producing spurious overflows. A high-level conditional assignment is not permission to multiply two changing coordinates inside one row.

Done when independently specified IR transitions agree with compiled matrix execution at instruction boundaries for focused examples and range boundaries. Include an atomic swap, both paths of a branch, a loop, a full-range copy, and preservation of unrelated registers. Include two independent counter computations that overlap, finish on different ticks, hold their results, and join exactly once. Record temporary-register counts and update costs for each implemented primitive.

If a primitive only supports a narrower proved range, make that limitation explicit in compilation diagnostics until general lowering is available. Do not silently narrow or wrap values.

### M2. Compile and visualize a source-level parity checker

Finalize a small grammar using the existing illustrative syntax as the starting point: one `main` function, typed parameters/result, literals, locals, assignments, affine/ReLU expressions, comparisons, `if`/`else`, `while`, atomic `parallel` assignments, return, and halt. Reserve and validate an unambiguous expression-form grammar for structured parallel branches and join-result destructuring; M3 completes source-level concurrent calls. Specify operator precedence and the meaning of natural-number subtraction. Arbitrary multiplication and division are not required for this milestone.

Configure token positions and preserve source spans through the CST visitor. Semantic analysis resolves names and checks types before lowering. Add useful lexical, syntax, and type errors, including integer literals outside the supported range. Validate the grammar through Chevrotain's self-analysis; test keyword/identifier boundaries, operator precedence, comments, character/string escapes, unexpected tokens, and incomplete blocks. Recoverable editor parsing may return partial syntax, but any lexical or syntax errors block matrix compilation: a recovered tree is not permission to execute malformed source.

Build a thin browser page with source editing, numeric input, Compile, Run, Pause, Reset, phase stepping, complete-matrix-update stepping, instruction stepping, a register table, an LED/result view, and an end indicator. The primary step control advances Multiply -> Apply ReLU -> Commit. Show current state, signed pre-ReLU vector, and rectified candidate side by side, highlighting negative-to-zero changes and errors without truncating wide values. Display matrix dimension and nonzero count. For small matrices, show a coefficient grid; larger ones need a bounded/virtualized or sparse view.

Selecting a destination row shows every contributing source value, coefficient, weighted term, signed sum, and ReLU result. Connect row/column/register selection with source and compiler-phase highlighting. Add bounded history inspection for the first examples, explicitly showing retained ticks. These educational features are required for M2; M7 improves their usability rather than introducing them for the first time.

Keep runs in bounded batches so cancellation and page interaction remain responsive. Source highlighting comes from compiler metadata, not guessed mappings from matrix rows.

Done when the parity example compiles and executes entirely through the generated recurrence for both even and odd inputs, with inspectable pre/post-ReLU phases and exact selected-row calculations. Its result drives the LED, both outcomes terminate, and toggling the LED or tracing changes no matrix coefficients or dimensions. Include a simple negative-preactivation example and inspectable overflow case. Compilation diagnostics point to source text. This is the first usable educational demo.

### M3. Add shared regular functions and first-class parallel computation

Extend the parser and semantic analysis for multiple functions, calls, and structured parallel expressions. Build the call graph, reject direct or indirect recursion in regular functions, and compute transitive effects and a bounded context structure. Compile one body per regular function per sequential context with static parameter/local/result storage and explicit return-location routing.

Implement argument evaluation, pass-by-value transfers, nested calls, result handling, and local reinitialization. Preserve caller values that must survive a call. Share sequential calls within each context; instantiate separate function banks/circuitry when calls can run concurrently. Small-function inlining can be considered after the shared convention works.

Compile fork preparation, simultaneous branch activation, independent branch progress, local completion/result retention, all-done joining, and reinitialization for later executions of the same group. Include finitely nested groups; reject shared mutable writes, branch global-halt effects, and direct/indirect device I/O. No host scheduler may serialize branches or substitute direct source execution for these circuits.

Done when a parity helper called sequentially from two locations, including a loop, has one shared body in its context, while two parallel calls have independent instances that overlap in the matrix trace. Verify unequal durations, zero-valued completed results, join exactly once, a repeated fork without stale state, nested groups, preserved parent/branch locals, and that branch completion never raises global end. Add a regression showing a sequential program gets no unused branch banks or join gates.

The browser shows each active branch, multiple current source locations, completed branch results, and the parent waiting at a join. A single matrix step advances all active contexts. Instruction stepping for a selected context still runs whole global updates, so other branches also progress. Size reports expose per-function instances, concurrent context count, and replication costs. This milestone is required before optional I/O integration; computational parallelism is not postponed to later work.

### M4. Add independently optional I/O

Implement capability reachability/linking before final allocation. First add character output, then blocking character input, then the six-coordinate screen port. Use the same shared-function machinery for device helpers, including pixel drawing loops and literal-string output. Enforce the transitive branch-effect rule: users may compute pixels/characters in parallel, then emit their results sequentially after the join.

Implement per-tick events, reusable payload latches, input suspension, EOF, immutable event payloads, retained host screen memory, and deterministic event order. Emit events only at commit, never while inspecting a multiplication or ReLU preview. Reserve input packets for an inspected candidate and consume them only when its step commits. A same-tick final pixel/character is applied before end; an input request cannot consume a character after end.

Add compiler/UI toggles for console input, console output, and the display. Check disabled-device calls at compile time, and remove enabled-but-unused capabilities as well as unreachable library helpers. The LED remains a read-only binding rather than a linked peripheral.

Done when a character echo program and a pixel-drawing program work in the browser. A diagonal uses the same six screen positions for every pixel. A parity program's executable artifact is unchanged by merely allowing unused devices; it has no `B`, console ports, screen port, or device-specific phases. Input-only and output-only artifacts remain independent.

Verify consecutive emission ticks, reused payloads, final events with end, pixel persistence, edge coordinates/colors, invalid arguments, suspension/resume, and a replayable sequence of delivered input and output events. Full checkpoint-based branching/replay UI can follow later; phase inspection and bounded earlier-tick viewing are already required in M2.

### M5. Add the WebAssembly execution backend

Implement the same artifact contract in Rust and compile it to WebAssembly. Validate imported artifacts, use sparse rows and double-buffered state, widen weights/state correctly, and use the established bounds for signed 64-bit accumulation. Keep all committed-state and fault semantics identical to the reference executor.

Expose exact signed raw output and wide rectified candidates through the phase-debugging API as well as the complete-step/batch API. Debug scratch is separate runtime memory and must not enlarge `W` or become new program registers. Verify that previews have no I/O effects and that both backends show identical per-row calculations and pre/post-ReLU values.

Run batches inside WASM, inspecting gates after every committed update. Return at end, faults, input boundaries, breakpoints/budgets, or event-buffer limits. Transfer batched character/pixel events to the UI without losing ticks. Run the backend in a browser worker and keep matrix/state allocations in WASM memory across batches.

Done when WASM and the reference backend agree on every committed state and event for the milestone examples and generated small valid artifacts, including parallel fork/join state, finished-branch retention, faults in one branch, overflow, and input boundaries. Compare both at the matrix-update level, not only final answers. Add a browser smoke test for loading and running the actual WASM module. Hardware threading is not required to implement the global simultaneous-update semantics.

Measure startup, committed updates per second, memory, and interaction latency on representative matrices. Optimize only after correctness matches; SIMD is a later measured optimization, not an initial requirement. The source numeric model remains 32-bit.

### M6. Add explicitly recursive functions

Enable `rec fn` and mutual recursion under the rule that every function in a call-graph cycle must be declared recursive. Keep regular functions on their existing per-context static-storage convention.

Define bounded frame layout, per-context capacity, return locations, saved live locals/intermediates, and an explicit stack-overflow outcome. Concurrent contexts own separate stacks. Compile push, restore, and return as matrix operations. Frame selection and transfers must not be performed secretly by the host runtime. Reject recursive creation of new parallel groups, including indirect spawn cycles, until a separate bounded task-creation design exists; recursive calls inside already allocated branches are supported.

Done when a small recursive sum/Fibonacci example and a mutually recursive example execute correctly. Include two concurrent pure recursive computations with independent stacks, and a sequential recursive call that reads or writes a character. Check stack limits, preserved locals, correct return destinations, transitive effect rejection within branches, and one shared recursive body per context. Validate both runtimes. General unbounded recursion and tail-call optimization are outside this milestone.

### M7. Make the playground useful for exploration

Improve source editing, the sparse matrix view, register grouping, parallel-context/join and call/stack inspection, device panels, stepping, and example selection. Make the end state, pending join, pending input, numeric fault, budget pause, and stack overflow visibly distinct.

Add artifact/source export and import, checkpoint/replay controls, and useful size/cost reports: matrix dimension, nonzero weights, persistent/temporary/control/device coordinates, and updates per source instruction or function call. Checkpoint restoration includes the input queue and retained host screen, not just the matrix state.

Recreate the primality example in source and compare its answers with the original reference; a newly compiled implementation need not have the original 24 coordinates or exact tick counts. Add device-free parity, shared calls, concurrent computations, recursion, echo, and pixel drawing to the example gallery.

Done when a user can understand a program's generated matrix, inspect its execution, reproduce an input-driven run, and see the size effect of enabling a used device. Finish build/CI/browser checks and document local usage. Public deployment is a separate task from completing a working local playground.

## 5. How to start the first implementation change

The first implementation change should complete M0 and begin M1 with a narrowly chosen parity fixture. Its deliverables are:

1. TypeScript development/test/build scaffolding and CI checks.
2. The versioned sparse artifact interfaces and validator.
3. Exact reference multiplication/ReLU/commit phases with inspectable raw values, numeric faults, end, and LED metadata.
4. A small named-row builder and hand-authored parity fixture.
5. Focused tests proving the actual recurrence and termination behavior.

The next change completes enough lowering and parsing for M2's browser demo. Do not start by implementing the whole language, every device, recursive frames, and WASM in a single change. Each milestone should leave a runnable, inspectable result for the next one.

## 6. Scope held for later

Defer dynamic arrays/heap allocation, arbitrary-precision program values, 64-bit source types, dynamic task creation, recursively spawning parallel groups, concurrent shared-device I/O, shared-memory threads, nonblocking input, pixel readback, atomic frame presentation, general file/network devices, aggressive register sharing/inlining, SIMD, and a plugin ecosystem. Structured computational parallelism is core scope and is explicitly not in this deferred list.

No schedule or speedup is promised before the first implementation exposes real compiler/runtime costs. The primary progress measures are working examples, exactness, explainable generated state, shared code, and absence of unused-device overhead.
