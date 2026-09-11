# Numeric Model and WebAssembly Runtime

This document records the fixed-width runtime design. The user has confirmed 32-bit stored program numbers. Exact BigInt and WAT-based WebAssembly backends are now implemented and differentially tested. See [IMPLEMENTATION.md](IMPLEMENTATION.md#runtime-and-debugging) for shipped behavior; the broader proposals below remain a roadmap.

## 1. Initial choice: 32-bit storage, 64-bit accumulation

The initial target uses:

| Value | Representation |
| --- | --- |
| `nat` and machine state coordinates | Unsigned 32-bit integer, `0..4,294,967,295` |
| `bit`, `char`, `u8`, `index16` | The same physical word, with tighter semantic bounds |
| Nonzero coefficients in `W` and `B` | Signed 32-bit integer, `-2,147,483,648..2,147,483,647` |
| Products and row sums inside the executor | Signed 64-bit integer, subject to certified accumulation bounds |
| Sparse offsets and register indices | Unsigned 32-bit values, with allocation limits checked |

The 64-bit accumulator is implementation machinery, not a user-visible 64-bit variable or extra persistent machine register. It allows cancellation and negative values before ReLU without wrapping a 32-bit product.

This interprets the requested numeric limit as a limit on stored program values. It does not require every intermediate CPU instruction to use the same width.

Use 32-bit state as the agreed numeric model, and benchmark before claiming a speed advantage. There is no automatic switch of source numeric semantics based on the host CPU. Any future 64-bit profile would be an explicit language extension with separate semantics, not merely a changed typed-array declaration.

## 2. Why 64-bit state is not automatically free

WebAssembly provides scalar `i32` and `i64` integer types. Its `v128` type is a vector type, not a general scalar integer type with full 128-bit multiply/accumulate semantics. [WebAssembly type specification](https://webassembly.github.io/spec/core/syntax/types.html).

The relevant operation here is an exact signed weighted sum followed by ReLU, not an isolated integer addition. There are several tradeoffs:

- A 64-bit state vector occupies twice as many bytes as a 32-bit vector with the same coordinate count. Double buffering preserves that factor. If coefficients also widen, coefficient storage doubles; sparse index storage need not change. Smaller storage can improve cache behavior, but does not establish a particular runtime speedup.
- A signed 32-bit weight multiplied by an unsigned 32-bit state value fits in a signed 64-bit product. Summing multiple products still needs a bound check or proof.
- Full-range 64-bit state can exceed a signed 64-bit accumulator even with small coefficients. General exact multiplication with wider coefficients requires multiword arithmetic or restrictive range proofs. A generic executor cannot simply use wrapping `i64.mul` and retain mathematical ReLU semantics.
- SIMD can help suitable kernels, but widening products and irregular sparse access complicate vectorization. More narrow lanes alone do not imply a proportional speedup for this workload.

These are reasons to start with 32-bit storage, not measured results for this project. Some bounded workloads could run similarly with 64-bit state. Specialized rows with proven bounds could avoid wide-emulation costs, so a meaningful comparison must use equivalent correctness guarantees and representative matrices.

## 3. Exact updates and overflow

Each row computes the mathematical signed sum first:

\[
s_i = \sum_j W_{ij}x_j + \sum_k B_{ik}u_k.
\]

Its candidate next coordinate is:

\[
y_i = \max(s_i,0).
\]

If `y_i > 4,294,967,295`, execution reports `NumericOverflow`. It does not wrap or clamp to the largest value. Negative sums still become zero: this is normal ReLU behavior, not underflow.

Intermediate partial sums may exceed the 32-bit range and later cancel. Apply the state-range check only after the complete row sum and ReLU, not after every term. Apply ReLU once per row, not once per product.

For example, `relu(2*x - x)` at `x = 4,294,967,295` should return that same value, even though the first product exceeds 32 bits. Conversely, `relu(x + 1)` at that input faults.

WebAssembly integer addition and multiplication use modular arithmetic at their instruction width. Therefore the backend must explicitly widen operands and establish safe accumulation bounds; the instructions do not supply the desired overflow policy automatically. [WebAssembly integer operation specification](https://webassembly.github.io/spec/core/exec/numerics.html#integer-operations).

### Preventing accumulator overflow

One product fits signed 64 bits, but an arbitrary row sum need not. Before accepting a compiled matrix, establish for every row a conservative bound such as:

\[
\sum_j |W_{ij}|M_j + \sum_k |B_{ik}|U_k \le 2^{63}-1,
\]

where `M_j` and `U_k` are valid maximum values of state and input coordinates. The global unsigned 32-bit maximum is always available as a conservative bound. Tighter bounds require verified invariants or runtime enforcement, not an unchecked annotation.

The absolute-sum bound protects every partial sum regardless of addition order. A signed 32-bit minimum coefficient must be widened before taking its absolute value. Compute the certificate in exact compiler arithmetic, for example TypeScript `BigInt`.

If the compiler cannot establish an accepted accumulator bound, it must reject the matrix with a diagnostic or produce a semantics-preserving alternative lowering that passes validation. It cannot silently split a signed sum across ReLU stages: rectifying intermediate negatives can change the result.

Likewise, a source constant or operation that requires a coefficient outside signed 32-bit range needs valid lowering, such as a separately initialized constant coordinate or an appropriate multi-step routine. Casting an oversized coefficient to 32 bits is not valid compilation.

### Atomic update failure

The executor computes candidate state into a separate buffer. Only after all rows pass does it swap buffers and advance the tick. On numeric failure it retains the last committed state, returns a fault with the row/source location, and emits no output from the failed update.

`NumericOverflow` is an executor fault; it need not be synthesized by writing a new machine coordinate after failure. A preceding output event stays committed. An input delivery selected for a failed step must not be silently consumed as if the step succeeded: retain or record its failed status consistently with checkpoint/replay semantics.

This gives a checked, partial recurrence: every successful step equals exact integer matrix multiplication followed by ReLU, while an out-of-range result terminates execution explicitly.

## 4. WebAssembly execution architecture

Keep parsing, type checking, source maps, and application coordination in TypeScript. Run the repeated sparse matrix-vector multiply, input addition, ReLU, and range checks inside WebAssembly.

Educational phase inspection is required in both runtimes, as specified in [DEBUGGER.md](DEBUGGER.md). Expose the exact signed row vector before ReLU and the rectified candidate before narrowing/commit. Debug mode separates multiplication, rectification/validation, and commit; fast mode may fuse loops while preserving the same committed behavior. Keep pending raw/candidate buffers outside the mathematical state vector, so the inspector adds no matrix coordinates.

The proposed first backend uses compressed sparse rows:

```text
row_offsets: u32[]
column_indices: u32[]
weights: i32[]

state_current: u32[]
state_next: u32[]
```

The input matrix can use a separate small structure or equivalent fixed input-column encoding. Its contributions participate in the same complete row sum before ReLU.

Device dependencies are resolved before allocating these structures. Disabled or unused peripherals contribute no rows, columns, nonzero entries, or device-specific state/control storage. Omit `B` entirely when console input is absent. Every artifact identifies its core end coordinate, checked as a whole word for nonzeroness. An optional LED maps an existing coordinate to a host-side nonzero display and adds no machine storage. A pure program needs no console/screen polling or universal I/O wrapper. Details and interface sizes are in [IO.md](IO.md).

For each row, the executor:

1. Sign-extends each coefficient to `i64` and zero-extends its state value to `i64` before multiplication.
2. Accumulates all terms, including input contributions, with the validated row bound.
3. Applies ReLU using a signed comparison of the sum with zero.
4. Checks the unsigned 32-bit upper limit and stores the candidate value only if valid.

The current buffer is read-only during the update. The next buffer is separate, preserving simultaneous assignment. A dense reference or alternative kernel is possible, but sparsity is the expected fit for compiled control and register operations.

A phase-stepped update binds the old state and any reserved input packet until commit or cancellation. Negative preactivations and overflowing candidates remain inspectable without unsigned truncation. No preview advances the committed tick, emits an output event, or consumes input. An overflow report retains its raw/candidate evidence alongside the last valid state. The browser's weighted-term explanation is computed from the same captured artifact/state/input as the executor.

Structured parallel branches occupy separate state/control regions of this same artifact. Each successful global update advances all active contexts. Branch-local completion, holding finished state, and joins are encoded in matrix circuitry; the host does not run branch functions directly or omit selected rows. A scalar WASM implementation may evaluate those rows one after another internally, but all read the same old state and commit together. Hardware threads and SIMD are optional performance optimizations, not the definition of language parallelism.

If one branch causes a numeric fault, the existing atomic-update rule applies to the entire candidate state. Completed branches must have safe holding circuitry so subsequent sibling work neither changes their results nor produces spurious faults. A local done flag is not the global end gate; the parent resumes only after the matrix join completes.

For `N` coordinates, each state buffer occupies `4*N` bytes. The display's six-coordinate output port occupies 24 bytes within one buffer, excluding helper state. Its retained 16-by-16 image lives in separate host/device memory and is not part of the recurrence. The matrix stores no implicit per-pixel framebuffer.

Expose state to TypeScript through typed-array views of WebAssembly linear memory. Avoid copying the entire matrix or allocating fresh JS objects on each update. Refresh views if memory growth invalidates them. The module implementation language and build toolchain are still open; TypeScript does not have to implement the numerical kernel itself.

### Batch execution and I/O

Provide a one-update debugging operation and a bounded batch operation. A batch stops at its budget, halt, fault, a breakpoint, an input request, or an event-buffer capacity boundary.

Normal halt is exactly `state[endIndex] != 0`, checked initially and after every committed update. Inspect final LED/output state and record same-tick character/pixel events before stopping; do not honor a simultaneous read request. Once stopped, the runtime freezes the committed state and executes no extra cleanup tick. A mathematical fixed point of every row is not required. `end` and device flags are whole 32-bit coordinates, never packed status bits.

The WebAssembly loop inspects output flags after every committed update and records character/pixel events. TypeScript receives batches of events rather than requiring one cross-boundary call per multiply or row. It can request stopping after each pixel emission for drawing inspection. Every pixel event contains the five payload values from its emission tick; the host applies events to its retained image in order.

Event payloads are immutable copies or use storage with an explicit lifetime; they cannot alias the reusable pixel port. Output-buffer exhaustion must return control before dropping or duplicating an event. Reserve enough event capacity before committing a tick, or retain the committed event as pending before allowing another update. Host image snapshots or a replayable pixel history accompany checkpoints; the matrix state alone cannot restore the screen.

At a console read boundary, execution returns control until a delivery is available. It must never batch past an undelivered read. These requirements preserve the protocol in [IO.md](IO.md).

Ticks and execution budgets are host bookkeeping, not source `nat` registers. Long runs may need counters wider than 32 bits; their interface must avoid truncation independently of the machine's numeric width.

### SIMD and other optimizations

Start with a correct scalar sparse WebAssembly kernel. SIMD is an optional optimization for row groups or dense blocks where data layout and verified bounds make it useful. WebAssembly SIMD provides packed vector operations, but the layout and toolchain must expose suitable parallel work. [V8's WebAssembly SIMD documentation](https://v8.dev/features/simd).

Do not substitute wrapping 32-bit lane arithmetic for checked wide accumulation. Do not replace the recurrence with direct source-level execution merely to improve benchmark results: any optimized backend must reproduce the same committed matrix states and I/O behavior.

Other candidates include specializing coefficient-one rows, precomputing row metadata, or compiling fixed row expressions to WebAssembly. Every optimization still needs equivalent arithmetic and error behavior. No performance multiplier is promised.

## 5. Consequences for existing designs

- Regular functions share their body across sequential call sites within a context. Concurrent contexts have distinct mutable banks and may replicate function circuitry. Recursive computations in concurrent contexts have separate bounded stacks. Local values use 32-bit state and overflow checks.
- A single register can no longer represent an unbounded stack. Moving to 64 bits would increase its finite capacity, not restore unbounded storage.
- `bit`, Unicode scalar, coordinate, and RGB ranges fit comfortably within the state width.
- The original Python primality example remains an arbitrary-precision reference. A port must constrain its input/state and preserve the bound's host-side computation without 32-bit truncation.
- General multiplication, division, and remainder in source programs remain compiled matrix routines. Having a native multiply instruction in the executor does not turn source multiplication of two changing registers into an affine matrix row.
- JavaScript numbers represent every stored `u32` value exactly, but are not a universally exact accumulator for products and sums of those values. Use `BigInt` in a slow reference evaluator when needed; this does not expose arbitrary-precision program variables.

## 6. Validation and performance decision

Before performance work, compare a backend with an exact reference evaluator on state transitions, terminal/fault behavior, and I/O event sequences. Include cancellation across large terms, the unsigned maximum, negative sums, overflowing results, signed weight interpretation, and rejected accumulator bounds.

Also compare exact pre-ReLU vectors, rectified candidates, and phase-stepped versus batch execution. Enabling debug history or switching inspection focus between parallel branches must change neither the recurrence nor event/input delivery semantics.

Then benchmark representative programs: arithmetic/control-heavy loops, shared calls, parallel computations with unequal completion times, recursive frames, pixel updates, and drawing plus I/O. Report parallel replication/memory costs alongside global update counts and wall-clock time. Include small and larger sparse matrices, warm up the execution engine, and separate initialization/compilation from steady-state execution and UI painting.

A 32-bit versus 64-bit comparison must state the coefficient widths, state ranges, exactness guarantees, and overflow policy of both profiles. Wrapping 64-bit accumulation is not a valid performance stand-in for a checked full-range 64-bit backend.

Report committed updates per second, memory use, event overhead, and end-to-end responsiveness on representative browser/CPU combinations. Compare scalar and SIMD only where each preserves the same semantics. A small arithmetic microbenchmark cannot settle the full-runtime choice.

The agreed design is 32-bit storage with native 64-bit accumulation. Benchmarks guide backend optimizations; a future numeric-width extension would require a separate decision. No 32-bit versus 64-bit runtime comparison has been performed yet.
