# Matrix Programming Language

An educational programming language that compiles programs into a fixed matrix applied repeatedly with ReLU:

\[
x_{t+1} = \operatorname{ReLU}(W x_t).
\]

The state vector holds data registers, control states, intermediate signals, and outputs. The matrix is the compiled program.

The implementation is TypeScript with Chevrotain for lexing/parsing and a browser interface for inspecting and visualizing execution.

## Run locally

Use Node.js 22.12+ (Node 24 recommended).

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite. Parity loads with input 4, paused at tick zero.
Selecting another example compiles it automatically. Changing a numeric input
resets execution to tick zero, paused and ready to step; W is unchanged.
Source, device, and compiler-option edits require **Compile & reset**.
**Multiply → Apply ReLU → Commit** advances one phase at a time without producing
I/O during previews. Full tick completes one matrix update; Run executes bounded
batches. Select a vector coordinate to inspect its actual weighted source terms.

```sh
npm test             # Parser, matrix runtime, compiler and example-program tests
npm run build        # Type-check and production build, including the WASM kernel
npx playwright install chromium
npm run test:browser # Chromium integration tests
```

## Included programs

| Program | Behavior |
| --- | --- |
| [Compact parity](examples/parity.matrix) | Exactly 6×6, no clock or peripherals. Result/LED 1 for even, 0 for odd; floor(n/2)+2 matrix updates. |
| [Simple primality](examples/prime-simple.matrix) | Your original counter-and-reset algorithm expressed in source. Tested against the original 24-coordinate recurrence. |
| [Optimized primality](examples/prime-optimized.matrix) | Odd trial divisors up to √n, repeated-doubling remainders, overflow-safe square increments. Reuses one remainder body at two call sites. |
| [Hello](examples/hello.matrix) | Prints `Hello, world!` and draws an H using 26 individual RGB pixel emissions. |
| [Greeting](examples/greeting.matrix) | Reads until Enter/EOF and prints `Greetings, <NAME>`. Stores 64 Unicode scalar values; drains and truncates excess input. |
| [Parallel countdowns](examples/parallel.matrix) | Two independent computations advance together, then join their results. |

The core browser workflow steps through multiplication, the signed output before ReLU, the output after ReLU, and committing the next state. Users can select a register/row to see its weighted contributions and follow source instructions and parallel branches. See [DEBUGGER.md](DEBUGGER.md).

The runtime uses 32-bit unsigned state, signed 32-bit matrix coefficients, and checked results computed with internal 64-bit accumulators. A WebAssembly backend executes sparse matrix-vector multiplication and checked ReLU. An exact BigInt reference backend provides differential verification and a browser fallback.

Console output, console input, and the RGB screen are independently optional at compile time. Disabled or unused devices add no matrix coordinates or device-specific control states. Pure programs use initial arguments and ordinary return values without linking I/O devices.

Every program has an `end` output coordinate: nonzero terminates execution. An optional LED shows whether a selected existing coordinate is nonzero, adding no matrix storage. All gates are whole vector positions, not bits packed inside a number.

Structured parallel computations are first-class: branches advance together, keep separate mutable state, and join before the parent continues. Sequential call sites share a function body within their context; simultaneous calls may require separate matrix circuitry. Initial parallel branches perform computation, with console/screen I/O before or after the join.

See [DESIGN.md](DESIGN.md) for the discussion record: execution mechanics, language primitives, shared functions, explicit recursive functions, stack implementations, compiler architecture, and the original primality example.

See [IO.md](IO.md) for the end gate, LED, console character input/output, and six-coordinate RGB pixel-output port (`X, Y, R, G, B, emission_flag`). The browser retains the 16-by-16 screen image outside the matrix.

See [RUNTIME.md](RUNTIME.md) for the numeric model, the 32-bit versus 64-bit tradeoff, overflow semantics, and the proposed WebAssembly backend.

See [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) for the staged implementation plan, starting with an exact matrix executor and a source-to-matrix parity demo, then adding shared functions with structured parallel execution, optional I/O, WASM, and explicit recursion.

## Status

Working first implementation: parser, source-to-fixed-matrix compiler, shared
nonrecursive functions, structured parallel calls, optional I/O, exact reference
and WASM runtimes, browser phase debugger, and automated unit/integration/browser
tests. No source instructions are interpreted by the host during execution.

The compiler prioritizes small, inspectable matrices. Constant-stride countdown
loops can fuse directly into a recurrence; straight-line affine expressions use
feed-forward circuits. Neither needs a clock or main-call machinery. More general
control flow currently uses an 11-phase shared schedule, with unreachable code,
redundant transfers, and unused circuitry removed. One source
statement can require many updates. The greeting's fixed-array selection
circuit is substantially larger than the pure examples. Large prime inputs can
still be slow; Run is cancellable and tests establish a tick-count improvement
over the simple algorithm, not native-code performance.

Implemented syntax and its differences from the design roadmap are documented in
[IMPLEMENTATION.md](IMPLEMENTATION.md). The preset selector is near the top and
selects only its used devices. Mathematical matrix/vector views precede the
detailed coefficient inspector, ports, source, and row calculations. You can
inspect every coefficient (including zeros) and export the entire sparse matrix
as JSON or nonzero-entry CSV.

Explicit recursive stacks, atomic parallel
assignment syntax, a worker-based runner, breakpoints, and historical replay are
not implemented yet. The browser currently retains a short summary of recent
sampled commits, not a rewindable trace. The broader design documents below are
the roadmap, not a claim that every proposed feature is shipped.
