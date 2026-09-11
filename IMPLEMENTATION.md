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
Calls do not use host callbacks. `rec fn` is recognized but rejected with an
explicit not-yet-implemented diagnostic; there is no recursive stack yet.

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
load, simple primality runs with input 6.

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
passes reduced the unchanged simple-primality source from 414 to 242 coordinates,
and optimized primality from 819 to 446. There is no primality recognizer or
hand-built primality matrix in the compiler; the original 24-coordinate matrix
remains only an independent test oracle.

### Further size strategies (investigated, not yet implemented)

The current simple-primality matrix has 242 coordinates: 122 operand-selection/
writeback coordinates, 93 program-counter/dispatch/branch coordinates, 11 clock
coordinates, 7 arithmetic coordinates, and 9 data/constant/end coordinates. Seven
of those last nine are data registers. Optimizing the transfer and control
circuits is more promising than further variable reuse.

1. **Fuse comparisons into branches.** Seven source conditions currently lower
   to 13 comparison instructions plus branch instructions. An equality predicate
   can use `p=relu(a-b)`, `q=relu(b-a)`, `equal=relu(1-p-q)` and drive the branch
   directly, without copying predicate intermediates through general registers.
   Existing operands must settle before the branch samples them. Estimated
   savings are roughly 50–90 coordinates; this is an architectural estimate,
   not an implemented or benchmarked size result.
2. **Fuse main's constant return with end.** A true-return pulse can directly
   set the initially zero result; any return pulse sets end. This targets three
   result-writing instructions and their writeback circuit—about 15 coordinates
   before secondary savings. Reused helper functions need separate reset and
   routing rules; main need not inherit that machinery.
3. **Specialize clear/small-constant assignments.** Constant updates and proven
   narrow results should not require full-u32 transfers. This is especially
   useful for Boolean results and counter resets. General primality counters
   still need full-u32 support; silently limiting the input is not an optimization.
4. **Summarize pure countdown loops, optionally.** A decrement-to-zero loop can
   become a clear. For paired decrements, the general result is
   `y = relu(y - old_x); x = 0`; clearing both requires proving `y <= old_x`.
   An equivalent-source diagnostic reduced the current simple-primality matrix
   from 242 to 235 with one reset summary and to 228 with both, agreeing for
   inputs 0–32. No example source was replaced and no such compiler pass was
   enabled. This changes the educational trace substantially, so it should be
   explicit if implemented.

These strategies are reusable compiler rules, not hand-built primality matrices.
Their savings overlap and should not be added together. None proves a globally
minimum matrix size.

## How source becomes a fixed W

The Chevrotain lexer/parser produces a CST; a visitor builds the typed AST.
Semantic checks and lowering build control-flow instructions and static function
instances. Matrix generation creates sparse rows and metadata. The runtime only
multiplies this fixed matrix, applies ReLU, validates bounds, and services ports.

In the general control-flow lowering, each context has a shared arithmetic circuit. An 11-phase clock schedules
one lowered instruction per active context at a time:

| Update within instruction | Circuit action |
| --- | --- |
| 1 | Active program counter emits an execution pulse. |
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
