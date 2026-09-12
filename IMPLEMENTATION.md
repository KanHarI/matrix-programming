# First implementation

This document describes the executable language and runtime. The earlier design
documents retain the broader roadmap; where they differ, this file describes the
current implementation.

## Language

```text
fn increment(n: nat) -> nat { return n + 1; }

fn main(n) {
  let first = increment(n);
  let second = increment(first); // same compiled function body
  return second;
}
```

All scalar values are unsigned 32-bit naturals. Optional annotations must be
`nat`; other types are rejected. Arithmetic supports addition and saturating
subtraction (`2 - 5` is zero). Comparisons `== != < <= > >=` return exactly 0 or 1.
`if` and `while` treat any nonzero condition as true. Overflow faults atomically;
it does not wrap. Decimal integer literals, parentheses, comments, string
literals, `let`, assignment, functions, loops, branches, and numeric returns are
supported. Falling off a function returns zero. Locals are block-scoped; shadowing
an existing binding is rejected. Functions cannot access other functions' locals.

Every call is compiled into parameter transfers, a saved return-location gate,
entry activation, a shared function body, and return routing. The ordinary call
graph must be acyclic, including unused declarations. Each sequential execution
context owns one instance of a function, regardless of its number of call sites.
Calls do not use host callbacks. Explicit `rec fn` supports direct self recursion
using separate fixed activation banks for parameters, locals, scratch storage,
code, and return gates. `CompileOptions.recursionDepth` defaults to 16 and accepts
1–32 simultaneous activations per recursive function per context. The default
recursive factorial preset has 1409 coordinates and 3991 nonzero weights.

The next recursive call selects the next compiled bank; exceeding the capacity
raises an ordinary gated matrix fault only when that call executes. Base cases
at the capacity boundary still work. Repeated sequential calls reuse the banks;
parallel contexts own independent banks. Regular helper bodies remain shared.
Unused recursive declarations add no matrix circuitry. This is not a single
shared recursive body with a dynamically addressed stack: depth increases code
as well as data size. Mutual recursion, recursive main, and self recursion via
parallel spawning are rejected explicitly. Factorial uses source-level repeated
addition, supports 0! through 12!, and faults on overflow instead of wrapping;
no factorial runtime builtin exists.

```text
let (a, b) = parallel { compute(n), compute(n + 1) };
```

Each branch calls a regular function in a separate context with its own locals,
program counters, arithmetic circuit, result, and completion gate. Inputs are
prepared before all branches start on the same tick. The parent joins only when
every branch completes, even when a returned value is zero. Completed branches
hold their results. Repeated and nested forks are supported; branch roots reset
their completion flags before reuse. I/O and global halt are rejected transitively
inside branches. LED bindings are read-only metadata and permitted.

`let buffer[64];` allocates 64 ordinary coordinates, initialized to zero each time
the declaration executes. Both literal and dynamic indices support reads and
writes; an out-of-range index faults. Capacities are 1–256. Dynamic indexing is
currently lowered to explicit comparisons and branches, not host array access.
There is no heap, variable-length array, or character/string value type; only
`print` accepts string literals. General multiplication, division, remainder,
Boolean operators, break/continue, atomic parallel assignment, and recursion are
not language primitives in this version. The examples implement remainder using
addition, subtraction, loops, and a shared helper.

Compilation limits protect the playground: 100,000 source characters, 10,000
lowered instructions, 100,000 coordinates, and 32 statically allocated contexts.
These limits are diagnostics, not a runtime timeout or a promise of fast execution.

## I/O

| Facility | Source API | Matrix interface |
| --- | --- | --- |
| End | `return value` from main or `halt()` | One required end coordinate. Nonzero stops after observing final output. |
| LED | Main result by default; `led(value)` binds an observation | Existing coordinate only; no added hardware. |
| Console output | `print("literal")`, `putc(codepoint)` | Codepoint + emission flag. |
| Console input | `read()` | Request + available/EOF/codepoint latches. |
| Pixel screen | `pixel(x, y, r, g, b)` | X, Y, R, G, B, emission flag: six coordinates. |

The browser retains the 16×16 image outside the matrix. Coordinates must be in
0–15 and RGB channels in 0–255 when emitted. Codepoints must be valid Unicode
scalar values, not surrogate halves. Each completed tick with a nonzero emit
produces an event, including consecutive emits. Previews never emit.

The compiler API and example playground allow devices by default but allocate
only devices referenced by compiled function bodies. Explicitly disabling a used
device produces a compilation error; disabling an unused device changes neither
matrix dimension nor coefficients. The LED can be hidden without compilation.
This is an intentional usability difference from the original default-disabled
capability proposal. The current compiler does not perform dead-statement
elimination within a compiled body.

A pending read pauses the entire recurrence when the queue is empty and still
open. Queued input is reserved during Multiply and consumed only on Commit. The
fixed input injection B places a packet in the three latch rows, whose W rows are
zero; compiled delay rows capture it before it clears. The host never writes data
or control registers to execute an instruction.

`read()` returns a Unicode scalar, or **4294967295 for EOF**. This non-Unicode
sentinel is distinguishable from NUL (0), LF (10), and an empty open stream. EOF
is explicit and queued characters drain first. This recoverable EOF behavior
supersedes the earlier proposed `ConsoleEndOfInput` fault. The browser delivers
characters immediately; Enter sends LF and Backspace sends character 8. Paste
preserves character order and newlines; the EOF button closes the stream. Input
resumes a playing run automatically, but never a manually paused run. On page
load, parity is ready with input 4, paused at tick zero.

The execution toolbar and mathematical view share one panel. Input values are
highlighted blue only in committed `x_t`; weight rows and preview vectors do not
inherit that input color. Running and Output cards sit beside the calculation on
desktop and below it on phones. Output reads the committed LED binding, explicitly
distinguishes a provisional value from a final result, and never reports a preview
as final. Matrix scrolling stays inside its viewport on small screens.

Four accessible keyboard-navigable tabs separate Presets, Program, Run, and
Inspect. Selecting a preset compiles it and opens Run, paused. The Program and
Inspect tabs move the same editor node rather than copying it; Run and Inspect
share the same execution controls. Tab changes do not reset or pause execution.
Clicking a mathematical coordinate opens its exact row in Inspect. Errors remain
visible outside the tab panels, including errors raised while source is hidden.

Copy matrix to Python produces a complete dense destination-row/source-column
list of integer lists, including zeros. Copy input vector copies committed `x_t`,
the input to the next multiplication, not initial arguments or a preview. Both
formats are also valid JavaScript/JSON. Dense copy is limited to 10 million
entries and 32 MiB; larger exports use sparse JSON/CSV. Denied clipboard access
opens a selectable manual-copy dialog instead of reporting false success.

The greeting stores at most 64 scalars. It continues consuming excess input until
LF/EOF, then prints the retained prefix. This is a deliberate bounded-memory
example, not a claim of unlimited name storage.

## Size-first compilation

There is no universal language infrastructure block. The compiler chooses a
lowering from the program structure, independently of its name or runtime inputs.
Clock, operand-selection, function-return, parallel, stack, and device circuitry
are not mandatory parts of a matrix program.

A constant-stride countdown followed by a zero/nonzero test is compiled directly
into a small recurrent circuit. The default parity source has stride two and
compiles to **6×6 with 10 nonzero weights**, without a clock or main entry/return
sequence. Other supported strides use seven coordinates. This is a reusable loop
fusion rule, not a primality/parity builtin or a lookup of example matrices.
The compact parity runtime is floor(n/2)+2 updates. Large inputs are deliberately
slow in this size-first preset; there is no separate faster-parity preset.

Pure straight-line addition/subtraction programs use feed-forward circuits.
Inputs and constants propagate along aligned dependency paths, so partial
expressions cannot cause false overflow. `return 1` requires a 2×2 matrix;
identity `return n` requires 3×3. Neither has a general clock. Potentially
overflowing arithmetic remains observable even if its result is unused.

General control flow still uses a shared clock when this lowering needs one.
Control selectors sample its phases directly, rather than allocating a delay
pipeline per instruction. Unreachable instructions and jump scaffolding are
removed, single-use expression copies are coalesced, constant selections are
specialized, and dead matrix dependencies are pruned while preserving possible
faults. This is not a claim that the compiler produces globally minimal matrices.

Generated temporaries with non-overlapping lifetimes share physical scratch
coordinates. Liveness is computed over each function's control-flow graph;
concurrent contexts, separate function activations, named variables, and explicit
LED observations do not share these slots. The debugger labels reused slots as
scratch storage and keeps source/control markers for the currently executing code.

In-place additions/subtractions of representable constants compile directly into
the retained register's row, weighted by its instruction's dispatch gate. They
do not need a full operand-select/arithmetic/replace round trip. These general
passes initially reduced the unchanged simple-primality source from 414 to 242 coordinates,
and optimized primality from 819 to 446. The additional passes below now reduce
them to **95 and 306 coordinates**, respectively. There is no primality recognizer or
hand-built primality matrix in the compiler; the original 24-coordinate matrix
remains only an independent test oracle.

### Fused control and constant writes

Branch conditions feed small continuously evaluated ReLU predicates directly
into clock-qualified yes/no dispatch gates. For equality, these are
`p=relu(a-b)`, `q=relu(b-a)`, `equal=relu(1-p-q)`. Predicates settle before
dispatch samples them and are shared for identical physical operand pairs.
Comparisons used as ordinary values still materialize a Boolean. Arithmetic
operands retain their normal evaluation and overflow checks.

Main's constant returns through signed-i32 maximum write its initially zero
result and end on the same update. Helper and parallel-root returns retain
replacement/reset circuitry because those activations can be reused. Function
calls enter the first real instruction directly; no no-op entry PC is needed.

Targets whose replacement writers are all constants omit the new-value ALU
transfer. They keep a full-range selected-old-value gate and add the constant
from the dispatch pulse on the same commit. Constants above signed-i32 maximum
use multiple synchronous pulse coordinates with legal weight chunks. Mixed
variable/constant replacement writers retain the general shared path.

Measured default budgets (unchanged example sources):

| Program | Coordinates | Nonzero weights |
| --- | ---: | ---: |
| Parity | 6 | 10 |
| Simple primality | 95 | 263 |
| Optimized primality | 306 | 844 |
| Hello / draw H | 209 | 616 |
| Greeting | 2543 | 7512 |
| Parallel | 206 | 518 |

These are generic compiler rules, not hand-built primality matrices. No claim
is made that these sizes are globally minimal.

### Optional countdown summaries

`compile(source, { summarizeLoops: true })`, also exposed under **Compiler
options** in the browser, summarizes pure decrement-to-zero loops. It is off
by default because it changes intermediate vectors and educational traces.
A single countdown becomes a clear. For distinct words decremented once each
iteration, the general result is `y = relu(y - old_x); x = 0`; other words are
updated before clearing the counter. No array updates, calls, I/O, declarations,
or nested control are accepted inside a summarized loop. The artifact retains
the original source and source-line locations.

This is a speed/trace tradeoff, **not a guaranteed size optimization**: simple
primality becomes 106 coordinates instead of 95 because the paired summary
introduces general transfer circuitry. A diagnostic summarizing only its
single-counter clear yields 91 coordinates. Cost-aware selection of individual
summaries remains a possible next size strategy; defaults retain the smaller
95-coordinate circuit and the explicit reset loops.

Changing a valid numeric input in the browser resets execution to tick zero,
clears previews and device state, and enables stepping without recompiling W.
Invalid inputs disable transport until corrected. Pending source/device/compiler
option edits still require compilation and are not cleared by input changes.

## How source becomes a fixed W

The Chevrotain lexer/parser produces a CST; a visitor builds the typed AST.
Semantic checks and lowering build control-flow instructions and static function
instances. Matrix generation creates sparse rows and metadata. The runtime only
multiplies this fixed matrix, applies ReLU, validates bounds, and services ports.

In the general control-flow lowering, each context has a shared arithmetic circuit. An 11-phase clock schedules
one lowered instruction per active context at a time:

| Update within instruction | Circuit action |
| --- | --- |
| 1 | Active program counter remains stable while the shared clock advances. |
| 2 | Select operand sources. |
| 3–5 | Gate full-range u32 operands using three ReLU stages. |
| 6 | Assemble shared operand ports. |
| 7 | Compute `max(A + B - C, 0)`. |
| 8–10 | Gate replacement/old target values and resolve conditional dispatch. |
| 11 | Simultaneously commit register replacement and control transfer. |

Inactive arithmetic sees zero operands, preventing an untaken overflowing branch
from faulting. Full-range transfer cannot use UINT32_MAX as a weight because
weights are signed i32. With `H = 2147483647`, the three gate stages subtract
`H`, `H`, and `1` when the selector is zero, and subtract nothing when it is one.
Selector delays align all three stages. Register replacement uses
`old + selected_new - selected_old`. One-hot control ensures only the active
writer is selected. All these are literal rows in W, not runtime special cases.

Constants are self-retaining coordinates, including constants above signed-i32
range; they do not require out-of-range coefficients. Compile-time per-row
absolute-sum certificates and runtime coordinate-bound checks guarantee exact i64
accumulation. Negative sums clamp to zero; any candidate above its register's
bound faults before committing state, consuming input, or producing output.

The original 24-coordinate primality matrix is preserved as an independent test
oracle. Its compact hand-written schedule is different from the general-purpose
compiler's schedule, so compiled source does not have the same size or tick count.

## Runtime and debugging

`src/runtime.ts` provides `Machine` and an exact BigInt reference backend.
`kernel.wat` is a generic CSR i64 multiplication and checked-ReLU kernel, compiled
by `wabt` into `public/kernel.wasm`. This small WAT implementation replaces the
roadmap's proposed Rust backend; it requires no Rust toolchain. Both backends use
the same immutable program artifact and device contract.

`stepPhase()` advances Multiply → ReLU → Commit. Before commit, current state and
tick remain unchanged; exact signed raw sums and wide candidates remain
inspectable, including overflow. `step()` completes one update, and
`runBatch(budget)` performs at most that many committed updates. WASM batches use
the native checked-ReLU path and observe ports on every update. There is no
program-specific fast path.

The browser exposes mathematical matrix/vector overviews, current/raw/candidate columns, selected row contributions
(including input B contributions), a searchable, paged exact-coefficient grid,
full sparse JSON/nonzero CSV export, sparse W visualization, source-line markers,
active contexts, LED/end gates, console, and pixel screen. Presets appear near the
top and switch off optional devices they do not use. Source editing and detailed
debugging follow the matrix/vector and device views. Small matrices display every
coefficient; larger matrices use explicitly labeled excerpts and navigable windows,
not an N² DOM allocation. It runs bounded batches
on the main thread and falls back to exact BigInt if WASM cannot load. Large
programs can be slow; a worker runner is still planned. Source stepping and the
hand-optimized matrix editor are not implemented.

Recent history contains at most 24 sampled commit summaries, not every executed
tick or restorable checkpoints. The runtime preserves the latest 512 event
records while updating the complete current console transcript and screen at
every event. Historical replay, breakpoints, and transcript storage limits remain
future work. None of these host-side views adds matrix coordinates.

## Verification

Tests cover lexer/parser errors and precedence, the original primality oracle,
all five requested programs, full-u32 transfers, normalized comparisons,
saturating subtraction, exact sums beyond JavaScript's safe-integer range,
inactive overflow, atomic faults, differential reference/WASM execution, shared
calls, direct/indirect recursion rejection, nested/repeated parallel joins,
bounded arrays, input reservation/Unicode/NUL/EOF, final/consecutive emissions,
exact H pixels, and disabled-device matrix identity. Chromium tests exercise the
visible phase debugger, examples, console, pixels, device toggles, and mobile layout.
