# Matrix Programming Language

An educational programming language that compiles programs into a fixed matrix applied repeatedly with ReLU:

\[
x_{t+1} = \operatorname{ReLU}(W x_t).
\]

The state vector holds data registers, control states, intermediate signals, and outputs. The matrix is the compiled program.

The implementation is TypeScript with Chevrotain for lexing/parsing and a browser interface for inspecting and visualizing execution.

The [Manim video lesson](video/README.md) starts with the complete 6×6 parity
runs for inputs 4 and 5, then builds the unoptimized compiler's gates, clock,
control flow, functions, bounded recursion, and primality machine. It includes
reproducible rendering source and synchronized subtitles, with no audio.

## Run locally

Use Node.js 22.12+ (Node 24 recommended).

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite. Parity loads with input 4, paused at tick zero.
Use **Presets** to select an example, **Program** to edit its source, **Run** for
the matrix and devices, and **Inspect** for coefficients, vectors, and the same
source editor. Switching tabs preserves execution and edits.
The preset name remains visible in every tab while its source is unchanged;
changing inputs keeps the name, while editing source labels it Custom program.
Selecting another example compiles it and opens Run. Changing a numeric input
resets execution to tick zero, paused and ready to step; W is unchanged.
Source, device, and compiler-option edits require **Compile & reset**.
Open **Program → Compiler options** (also in Inspect) for 21 independent
optimization flags, with enable-all, disable-all, and restore-defaults controls.
Flags apply on compilation and stay selected when changing presets. Most are
on by default; loop summarization is off. Specialized lowerings can bypass
general-backend passes, so a flag need not affect every program.
**Multiply → Apply ReLU → Commit** advances one phase at a time without producing
I/O during previews. Full tick completes one matrix update; Run executes bounded
batches. Select a vector coordinate to inspect its actual weighted source terms.
In **Inspect → Matrix W**, the default **Logical rows** view shows named row
dictionaries instead of a grid of zeros. **Diagonal default on (1)** omits
self-weights of 1 and explicitly lists other diagonal values, including 0.
Unchecking it uses a zero diagonal and lists every nonzero weight. These are
absolute coefficient overrides; changing the view never changes execution.

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
| [Matrix computer](examples/matrix-computer.matrix) | A compiled Matrix-language simulator runs that 6×6 matrix as data. Prints the matrix, old vector, signed multiplication result, ReLU result and commit for every inner tick. Starts at 4; try 5. Only console output and the LED are linked. |
| [Simple primality](examples/prime-simple.matrix) | Unchanged counter-and-reset source, now 26×26 with 71 nonzero weights through generic counter/CFG optimizations. Tested against the original 24-coordinate recurrence. |
| [Optimized primality](examples/prime-optimized.matrix) | Odd trial divisors up to √n, repeated-doubling remainders, overflow-safe square increments advanced by 8 instead of multiplying. Reuses one remainder body at two call sites. |
| [Binary-division primality](examples/prime-binary.matrix) | Separate constant-storage variant: binary long division scans 32 input bits per remainder, with at most one divisor subtraction per bit. Keeps incremental squares. Faster for large quotients, but more overhead on small inputs; 314×314 versus 286×286 for the optimized preset. Starts at 4,294,967,295. |
| [Hello](examples/hello.matrix) | Prints `Hello, world!` and draws an H using 26 individual RGB pixel emissions. |
| [Greeting](examples/greeting.matrix) | Reads until Enter/EOF and prints `Greetings, <NAME>`. Stores 64 Unicode scalar values; drains and truncates excess input. |
| [Parallel countdowns](examples/parallel.matrix) | Two independent computations advance together, then join their results. |
| [Recursive factorial](examples/recursive-factorial.matrix) | `rec fn factorial`, with 16 fixed activation banks and source-level multiplication. Starts at 5! = 120; 0–12 fit in u32. |

The core browser workflow steps through multiplication, the signed output before ReLU, the output after ReLU, and committing the next state. Users can select a register/row to see its weighted contributions and follow source instructions and parallel branches. See [DEBUGGER.md](DEBUGGER.md).

### A matrix computer inside a matrix computer

Choose **Matrix computer · parity walkthrough** in Presets, then press **Run**
to see its transcript in the console. Or stream the same character emissions to
your terminal:

```sh
npm run matrix-computer -- 4
npm run matrix-computer -- 5
```

The inner matrix is stored as sparse row data in ordinary source arrays. A
generic row loop multiplies it by the old vector, keeps positive and negative
sums separately, prints signed `z`, applies ReLU, and commits only after all rows
have read the old state. Decimal formatting also runs in Matrix source. The
terminal adapter only loads the compiled artifact, runs it and forwards output;
it does not calculate parity or manufacture the trace.

The inner circuit is **6×6**; the outer simulator currently compiles to
**4019×4019** because it includes array selection, formatting, shared functions,
control flow and character output. Its ticks are not the printed inner ticks.
Input 4 takes four inner updates and 293,216 outer updates. Prefer small inputs:
this is an educational simulation, not an accelerated parity algorithm. State
is u32; signed intermediate values use two unsigned lanes. This matrix's lanes
fit u32, but arbitrary edited matrix data can overflow and fault.

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
nonrecursive functions, bounded direct self recursion, structured parallel calls, optional I/O, exact reference
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
[IMPLEMENTATION.md](IMPLEMENTATION.md). Presets select only their used devices.
Run shows the mathematical matrix/vector view and ports; Inspect contains exact
coefficients, source, and row calculations. Copy buttons export the entire dense
matrix or committed input vector `x_t` as integer lists valid in Python and JS.
Dense copy is capped at 10 million entries / 32 MiB; larger matrices can use
the full sparse JSON or nonzero CSV downloads in Inspect.

Recursion currently uses per-depth code/data banks, not one shared recursive body
with a dynamically addressed stack. Mutual recursion, atomic parallel
assignment syntax, a worker-based runner, breakpoints, and historical replay are
not implemented yet. The browser currently retains a short summary of recent
sampled commits, not a rewindable trace. The broader design documents below are
the roadmap, not a claim that every proposed feature is shipped.

## Deployment

The GitHub Actions workflow tests and builds every push/PR. Successful `main`
pushes (or manual runs on `main`) upload `dist` and deploy to GitHub Pages at
`https://matrix-programming.kanhar.art`. PRs never deploy. The deploy job uses
the `github-pages` environment and Pages configured for GitHub Actions; the
custom domain is configured in GitHub, not a generated CNAME file.
