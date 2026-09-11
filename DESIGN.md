# Matrix Programming Language: Design Notes

This document records the design discussion and its motivating example. It distinguishes agreed directions from proposed implementation details. Syntax is illustrative; it is not yet a language specification.

## 1. Direction and scope

The language compiles programs into a fixed matrix that repeatedly transforms a persistent state vector through ReLU. The initial demonstration is a primality test encoded in a 24-by-24 integer matrix.

The intended implementation environment is TypeScript. Chevrotain is the selected lexer/parser toolkit, following evaluation of parser-combinator and grammar-toolkit alternatives. This supersedes the original Parsec-style combinator proposal. The eventual interface is a web page with execution visualization.

The function design has these requirements:

- Function bodies can be shared across multiple call sites for size efficiency.
- Regular functions do not support direct or indirect recursion.
- Recursive functions can be added as a distinct, explicitly declared category.
- Both regular and recursive functions compile their bodies once; recursion changes invocation storage, not the requirement to share code.

Stored program numbers are 32-bit, as confirmed in the runtime discussion. I/O capabilities are independently optional: console output, console input, and the 16-by-16 RGB screen. Disabled or unused devices add no coordinates, matrix entries, or device-specific control states. A pure parity checker receives initial arguments and returns its result without linking any peripheral. See [IO.md](IO.md) for the capability toggles and linking contract.

Every program also exposes a required `end` coordinate: any nonzero value terminates execution. An optional LED displays whether a selected existing coordinate is nonzero, with no added matrix storage. Gates are entire 32-bit vector positions, not packed bits. The LED is normally enabled when bound to a register and can be hidden or rebound without recompilation.

Earlier discussion considered inlining all functions as a simple first compiler strategy. The subsequent requirement for size efficiency makes shared bodies the default design direction. Inlining remains a possible optimization for small functions.

## 2. Execution model

The underlying machine repeatedly executes:

```text
x_next = relu(W * x)
```

ReLU acts independently on each coordinate:

\[
[z]_+ = \max(z, 0).
\]

`W` is fixed during execution. Rows correspond to destination registers and columns to source registers. Each coordinate of the next state is the rectified weighted sum described by its row.

All updates are simultaneous and read the previous state. For example:

```text
next_d = relu(d + 2*i + 2*a - 2*b + k)
```

is one row of a matrix program.

This is a hand-compiled recurrent network, with no training required. A fixed matrix size does not imply a fixed execution duration. Earlier discussion considered exact, unbounded integer coordinates, which could encode unbounded information. The current runtime target instead uses 32-bit state, so a fixed vector has finite information capacity. See [RUNTIME.md](RUNTIME.md) for the numeric rules and WebAssembly execution proposal.

### Matrix updates versus instructions

A source-language instruction may require several matrix updates. Intermediate results must be computed before dependent operations use them. The compiler inserts temporary registers, control states, and execution phases to enforce those dependencies.

The primality example uses two matrix updates for each logical instruction: compute condition signals, then consume them to update counters and control state. This two-phase schedule is a property of that example, not a restriction on all future programs.

### Constants

A permanent coordinate supplies constants while retaining the homogeneous matrix form:

```text
one = 1
one_next = one
```

An affine expression such as `3*a - 2*b + 7` then uses a coefficient of `7` on `one`.

## 3. Proposed language primitives

### Registers and types

Initial types include nonnegative integers and Boolean bits. `nat` now means an unsigned 32-bit value in `0..4,294,967,295`; it does not promise arbitrary precision:

```text
nat n
nat divisor = 2
bit finished = 0
const one = 1
```

The compiler must preserve the `bit` invariant: its value is always zero or one.

A `bit` variable still occupies a whole 32-bit state coordinate. It is a semantic value restriction, not bit packing. The end gate and LED observation use nonzeroness and do not require the observed coordinate to be a `bit`.

Bounded natural-number types are a useful extension:

```text
nat<100> counter
```

The exact bound syntax and whether bounds are inclusive remain unspecified. Known bounds can make comparisons and conditional transfers more efficient.

Signed integers could be represented by two nonnegative coordinates, with the logical value `positive - negative`. A future signed source type would need its own declared range and overflow checks. Signed arithmetic is an extension, not a settled initial feature. Matrix coefficients are signed 32-bit integers, while row accumulation uses internal signed 64-bit arithmetic with verified bounds. Positive results exceeding the state range fault; negative row results still become zero through ReLU.

### Affine expressions and ReLU

The fundamental arithmetic expression is a weighted sum with constant coefficients, followed where needed by rectification:

```text
relu(3*a - 2*b + 7)
```

| Operation | Expression on nonnegative inputs |
| --- | --- |
| Copy | `a` |
| Addition | `a + b` |
| Constant scaling | `3*a` |
| Saturating subtraction | `relu(a - b)` |
| Saturating decrement | `relu(a - 1)` |

Subtraction on natural numbers must have explicit semantics. It may be saturating by definition or use a distinct operator such as `a ⊖ b`. Examples with ordinary subtraction under a sufficient guard are safe under either interpretation.

Multiplication of two changing registers, integer division, and remainder require compiled routines. They are not individual affine operations.

### Parallel and sequential assignment

Parallel assignment exposes the machine's simultaneous-update semantics:

```text
parallel {
    a <- b
    b <- a
}
```

This swaps `a` and `b`. Sequential statements outside a parallel block execute in source order. Registers omitted from an instruction should retain their values by default; the compiler must generate the required retention behavior.

Assignment syntax (`=`, `<-`, or another form) has not been finalized. A source-level parallel block may require multiple physical updates while still behaving atomically at instruction boundaries.

### Predicates and Boolean operations

Useful predicates include `is_zero`, `equal`, and `less_than`. For a nonnegative integer:

\[
\operatorname{isZero}(x) = [1-x]_+.
\]

Equality can be computed in stages:

\[
d = [a-b]_+ + [b-a]_+,\qquad
\operatorname{equal}(a,b) = [1-d]_+.
\]

For bits, negation and conjunction have simple forms:

\[
\neg a = 1-a,\qquad a \land b = [a+b-1]_+.
\]

These identities rely on integer and bit invariants. They do not define the same Boolean behavior on arbitrary real-valued coordinates.

### Control flow

The low-level representation can expose named states and transitions:

```text
state count:
    when equal(r, divisor):
        goto reset_remainder
    otherwise:
        parallel {
            t <- t + 1
            r <- r + 1
        }
        goto count
```

Higher-level `if`, `else`, `while`, and fixed-count `repeat` constructs compile into these states. State coordinates usually use one-hot control: exactly one relevant instruction is active at a logical instruction boundary.

Counter-machine operations form a useful implementation foundation:

```text
increment x
decrement x
branch_zero x, done, continue
```

Decrement saturates at zero. A bit can enable an increment through `x_next = relu(x + active)`.

Conditional transfer of arbitrary values needs more care. The expression `active * value` multiplies two changing coordinates and is not an affine operation. Known bounds permit compact gating constructions; the full `nat` range may require additional lowering to fit signed coefficient limits. Function calls, stack access, assignments, and branches must respect this limitation. The earlier arbitrary-precision model would additionally have required routines for unbounded transfers.

### Halt, input, and output

A source-level halt records a result:

```text
halt prime = true
```

The runtime terminates when the required end coordinate becomes nonzero, then preserves the final committed state by scheduling no further updates. A top-level return or `halt` compiles to raising end after preparing the result; returning from a helper does not raise end. This replaces the earlier proposal to require an absorbing mathematical fixed point, avoiding extra circuitry merely to freeze an already terminated program. The runtime observes final output events before honoring end and ignores any simultaneous input request.

Initially, the host initializes designated input coordinates, runs the recurrence, and reads designated output coordinates.

[IO.md](IO.md) extends this with console character input/output and a six-coordinate RGB pixel-output port: `X, Y, R, G, B, emission_flag`. Each emission updates one pixel in a host-owned 16-by-16 image; the matrix does not store the framebuffer. Character and pixel emissions are observations of completed updates. Blocking console reads introduce an explicit external input term, `x_next = relu(W*x + B*u)`, with fixed `W` and `B`; recorded input deliveries make interactive runs replayable.

### Invariants and execution contracts

Useful declarations include:

```text
invariant 0 <= r <= divisor
invariant 0 <= t <= n
invariant exactly_one(start, count, reset, done)
```

These can support validation and justify compact compiled operations. A proof or checking mechanism remains to be designed; a user declaration alone is not a proof.

An execution budget must be distinguished from a proved termination bound:

```text
budget updates <= 10000
```

Exhausting a budget does not by itself imply an incorrect program. A certified bound carries a stronger guarantee.

## 4. Functions and shared code

### Expression and procedural functions

Expression functions provide reusable calculations:

```text
fn difference(a: nat, b: nat) -> nat {
    return relu(a - b);
}

fn equal(a: nat, b: nat) -> bit {
    return relu(1 - difference(a, b) - difference(b, a));
}
```

Dependencies may require intermediate registers and multiple updates. Function syntax does not promise single-update execution.

Procedural functions may contain locals, branches, and loops:

```text
fn remainder(n: nat, d: nat) -> nat {
    let remaining = n;
    while remaining >= d {
        remaining = remaining - d;
    }
    return remaining;
}
```

This example requires `d > 0`; precondition syntax is a future design choice.

Proposed function semantics are eager argument evaluation, pass-by-value parameters, private local variables, local mutation, and one returned value. Tuples can be added later. Pass-by-value is a semantic guarantee; its physical implementation may need multiple matrix updates.

### Shared regular-function calling convention

A regular function is compiled once and reused by its call sites:

```text
let a = square(3);    // call site A
let b = square(5);    // call site B
```

```text
Call site A ----+                      +---- Continue A
               +---- Shared square ---+
Call site B ----+                      +---- Continue B
```

Each call transfers arguments into the function's registers, records its return location, and activates the function entry state. The function writes shared result registers. Its exit routes control to the selected continuation, which receives the result.

For Boolean control coordinates, routing can use:

\[
\text{continue}_A' = [\text{functionExit} + \text{returnToA} - 1]_+.
\]

Return-location flags persist during execution and are cleared during return. The compiler must schedule flag changes and value transfers correctly.

The full arrangement is encoded in one fixed matrix; calls do not modify the matrix or duplicate the body at runtime.

If a body costs `F` registers/control states, has `k` call sites, and each site's call/return machinery costs roughly `C`, inlining contributes approximately `k*F`, while sharing contributes approximately `F + k*C`, plus shared working storage. This is a schematic state-size comparison, not an exact matrix-entry count; a dense matrix's storage grows quadratically with its dimension.

For synchronous, sequential execution without reentry, each regular function can use statically allocated argument, local, result, and return-location registers. Nested calls to other regular functions do not require a stack: each function has its own storage. Concurrent invocations are outside the current design.

Inlining remains an optional optimization. A call inside a loop reuses its compiled code on each iteration under either strategy; source expansion does not mean runtime duplication per iteration.

## 5. Explicit recursive functions

Regular functions reject recursion. Recursive functions use a separate declaration and calling convention:

```text
fn square(x: nat) -> nat {
    return x * x;
}

rec fn factorial(n: nat) -> nat {
    if n == 0 {
        return 1;
    }
    return n * factorial(n - 1);
}
```

The multiplication in these examples is a compiled arithmetic routine.

| Property | `fn` | `rec fn` |
| --- | --- | --- |
| Compiled body | Shared across calls | Shared across calls |
| Invocation storage | Static registers | A frame for each active invocation |
| Return location | One saved location per function | Saved in each frame |
| Direct or indirect recursion | Rejected | Allowed |
| Stack requirement | None under the sequential calling convention | Required in general |

Before a recursive call, the compiler preserves the return location, live locals, and any intermediate values needed after the call. Return restores that invocation's state.

### Call-graph rule

Every function participating in a cycle in the call graph must be declared `rec fn`. For example, this is rejected:

```text
fn a() { b(); }
fn b() { a(); }
```

Mutually recursive functions are allowed when every participant explicitly opts in. The compiler can identify cycles through strongly connected components, including self-calls.

A regular function may call a recursive function. A recursive function may call an ordinary helper, provided that helper does not participate in a cycle. A helper that leads back into the recursive caller must itself be declared recursive.

Tail-recursive calls may later be optimized into jumps that reuse the current frame.

## 6. Stack implementation options

A call stack is compatible with fixed-matrix execution. Two approaches were discussed.

### Bounded, explicit frames

Reserve coordinates for a compile-time number of frames. Frames hold return locations, saved locals, and intermediate values. Control coordinates identify the active frame. Selection and transfers are compiled routines, not native indirect memory access.

The proposed first recursive runtime uses a program-level bound:

```text
stack capacity = 64;
```

The number is illustrative, not a chosen default. Overflow should produce an explicit result rather than silently corrupting state. Frame layout, heterogeneous frame sizes, and the precise overflow interface remain open.

An earlier illustration used `@max_depth(32)` on a function; the later proposal favors program-level capacity. Per-function limits remain an optional extension.

Explicit frames make memory cost and call state visible in the browser. They increase matrix size but do not duplicate function bodies.

### Unbounded stack encoded in integers

This subsection preserves a theoretical alternative discussed before the fixed-width decision. It is not an unbounded-stack option for the current 32-bit runtime: its encoding overflows when the stored value exceeds the register range. The same limitation would apply with 64-bit registers.

With exact unbounded integers, a finite stack of symbols can be stored in one coordinate. Choose base `B`, encode symbols as `1` through `B - 1`, and use zero for empty. The top is the least significant digit.

Push symbol `a`:

\[
S' = B S + a.
\]

Pop from a nonempty stack:

\[
a = S \bmod B,\qquad S' = \lfloor S/B \rfloor.
\]

For example, pushing 3, 7, and 2 in base 10 produces 372; popping returns 2 and leaves 37.

Constant multiplication is affine. Division and remainder can be implemented by repeated subtraction:

```text
quotient = 0
while stack >= B {
    stack = stack - B
    quotient = quotient + 1
}
symbol = stack
stack = quotient
```

This is an algorithm to compile, not a claim that a full push or pop, including control and preservation, takes one matrix update. An arbitrary frame requires serialization into symbols with unambiguous boundaries.

The encoding permits arbitrary finite depth in an ideal exact-integer model. It does not provide physically unlimited memory: integer representations grow with the amount stored. The elementary pop routine above can take exponentially many updates in stack depth.

The original unbounded model would need arbitrary-precision arithmetic, such as `BigInt`. The current runtime instead stores `nat` values as unsigned 32-bit integers; `BigInt` may still be useful inside a reference evaluator to check exact intermediate sums without becoming a source-language type.

Bounded explicit frames are the proposed implementation. Integer-encoded stacks would also be bounded under the current numeric model and offer no unbounded-capacity guarantee.

## 7. Parser, compiler, and web visualization

Chevrotain is the selected parser library. Define its lexer tokens and `CstParser` grammar rules in TypeScript, then convert the concrete syntax tree (CST) into our typed abstract syntax tree with a visitor. Preserve source spans and report lexical/syntax diagnostics before compilation. Parsing produces syntax; type rules, storage allocation, and calling conventions belong in later compiler stages. See the [Chevrotain parser tutorial](https://chevrotain.io/docs/tutorial/step2_parsing.html) and [CST visitor tutorial](https://chevrotain.io/docs/tutorial/step3a_adding_actions_visitor.html).

The proposed execution backend is WebAssembly, with sparse matrix storage, double-buffered 32-bit state, and exact bounded 64-bit accumulation. TypeScript retains parsing, compilation coordination, and the web interface. [RUNTIME.md](RUNTIME.md) explains the boundary and performance validation plan; no execution backend has been implemented yet.

The proposed pipeline, updated to reflect shared function bodies, is:

```text
Source text
  -> Chevrotain lexer and parser
  -> concrete syntax tree
  -> visitor producing a typed abstract syntax tree
  -> name resolution, type checking, and call-graph validation
  -> shared function lowering and calling conventions
  -> optional small-function inlining
  -> reachable device dependencies and optional device linking
  -> explicit control states and register operations
  -> matrix scheduling and register allocation
  -> fixed matrix, initial-state layout, and source map
```

The compiler should retain source locations, function identities, call sites, instruction boundaries, and register meanings. The browser can then display:

- The source instruction currently executing.
- Matrix coordinates and their named registers.
- Control states, condition signals, and counter values.
- Arguments and locals for the active function.
- Recursive stack frames and return locations.
- Single matrix updates as well as instruction-level stepping.
- Step-into and step-over behavior for function calls.
- Terminal results, execution-budget exhaustion, and stack overflow.
- Console character input/output, pending reads, pixel emissions, and the retained 16-by-16 RGB screen image, as specified in [IO.md](IO.md).

These are intended capabilities, not implemented features. Shared bodies require execution context in addition to a static source map to identify the current caller.

## 8. Motivating example: primality by ReLU

### Register roles

| Registers | Meaning |
| --- | --- |
| `n` | Preserved input |
| `d` | Candidate divisor |
| `t` | Total count toward `n` |
| `r` | Count within a block of length `d` |
| `I` | Initialization control |
| `S` | Start testing a divisor |
| `C` | Count upward |
| `U` | Reset `r` by decrementing |
| `V` | Reset both counters before the next divisor |
| `i s c u v` | Delayed control signals |
| `a b p e f g h k` | Intermediate conditions |
| `P Q` | Prime and not-prime outputs |

For `n >= 2`, the algorithm tests each divisor from 2 through `n - 1`. It increments `t` toward `n` while repeatedly counting `r` up to `d`. If both reach their limits together, a proper divisor has been found. Otherwise it resets counters and advances the divisor. Reaching `d == n` establishes primality.

Conceptually:

```python
def conceptual_prime(n):
    if n < 2:
        return False
    d = 2
    while d < n:
        t = r = 0
        while t < n:
            t += 1
            r += 1
            if r == d:
                if t == n:
                    return False
                r = 0
        d += 1
    return True
```

The actual matrix resets counters by decrementing, adding execution steps.

### Conditions and initialization

Reachable divisor-testing states satisfy `0 <= t <= n` and `0 <= r <= d`. Therefore:

\[
e'=[C+t-n]_+,\quad f'=[C+r-d]_+,\quad
g'=[C+t+r-n-d]_+.
\]

During counting, `e` signals `t == n`, `f` signals `r == d`, and `g` signals both. Outside counting, these generated signals are zero. The expression `c - e - f + g` enables another increment only when neither limit has been reached.

Other signals are:

\[
p'=[S+d-n]_+,\quad h'=[U-r]_+,\quad k'=[V-t-r]_+.
\]

They detect exhausted candidates, a completed remainder reset, and a completed full reset, respectively.

Initially, only `n` and `I = 1` are populated. The first update generates `i = 1`, `a = [1-n]_+`, and `b = [2-n]_+`. On the second update, `b-a` rejects 0 and 1; for larger inputs, the machine sets `d = 2` and activates `S`.

`P` accumulates the prime signal; `Q` accumulates the small-input rejection or divisibility signal. The host stops when exactly one output is one.

### Termination bound

For a candidate `d` that does not divide `n`, let `q = floor((n - 1)/d)`. The candidate test, including reset for the next divisor, costs:

\[
2n + q(d+2) + 3
\]

logical steps. This counts one starting transition, `n` increments, `q+1` counting-boundary transitions, `q` remainder resets each costing `d+1`, and a final full reset costing `n+1`.

Since `d >= 2`, `q(d+2) <= 2qd <= 2(n-1)`. Thus each candidate costs at most `4n+1` logical steps, or `8n+2` matrix updates. A divisor that succeeds terminates sooner.

There are at most `n-2` candidates. Including initialization and final prime detection, for `n >= 2`:

\[
\text{updates} \le 4+(n-2)(8n+2)=8n^2-14n < 8n^2+4.
\]

Inputs 0 and 1 terminate in two updates. Python's `range(1, 8*n*n + 5)` permits `8*n*n + 4` updates.

This is a quadratic bound on update count, not a complete bit-complexity analysis. The construction demonstrates programmability rather than an efficient practical primality algorithm.

### Original implementation

```python
import numpy as np

names = "n d t r I S C U V i s c u v a b p e f g h k P Q".split()

rows = {
    "n": {"n": 1},
    "d": {"d": 1, "i": 2, "a": 2, "b": -2, "k": 1},
    "t": {"t": 1, "c": 1, "e": -1, "f": -1, "g": 1, "v": -1},
    "r": {"r": 1, "c": 1, "e": -1, "f": -1, "g": 1, "u": -1, "v": -1},

    "I": {},
    "S": {"i": 1, "a": 1, "b": -1, "k": 1},
    "C": {"s": 1, "p": -1, "c": 1, "e": -1, "f": -1, "g": 1, "h": 1},
    "U": {"u": 1, "h": -1, "f": 1, "g": -1},
    "V": {"v": 1, "k": -1, "e": 1, "g": -1},

    "i": {"I": 1},
    "s": {"S": 1},
    "c": {"C": 1},
    "u": {"U": 1},
    "v": {"V": 1},

    "a": {"I": 1, "n": -1},
    "b": {"I": 2, "n": -1},
    "p": {"S": 1, "d": 1, "n": -1},
    "e": {"C": 1, "t": 1, "n": -1},
    "f": {"C": 1, "r": 1, "d": -1},
    "g": {"C": 1, "t": 1, "r": 1, "n": -1, "d": -1},
    "h": {"U": 1, "r": -1},
    "k": {"V": 1, "t": -1, "r": -1},

    "P": {"P": 1, "p": 1},
    "Q": {"Q": 1, "b": 1, "a": -1, "g": 1},
}

W = np.array(
    [[rows[dst].get(src, 0) for src in names] for dst in names],
    dtype=np.int64,
)

assert W.shape == (24, 24)

def is_prime_by_relu(n: int) -> tuple[bool, int]:
    if type(n) is not int or n < 0:
        raise ValueError("n must be a nonnegative integer")

    x = np.zeros(24, dtype=object)
    x[0] = n
    x[4] = 1

    # A proven sufficient bound, not an experimentally selected timeout.
    for iterations in range(1, 8 * n * n + 5):
        x = np.maximum(W @ x, 0)

        if x[22] + x[23] == 1:
            return bool(x[22]), iterations

    raise RuntimeError("The theoretical iteration bound was exceeded")
```

The object-typed state uses arbitrary-precision Python integer arithmetic. The input check accepts only built-in nonnegative `int` values, excluding Boolean values and NumPy integer scalar types.

This original example is preserved unchanged as a mathematical reference. Porting it to the current runtime requires restricting inputs to the `nat` range and checking all generated state against that range. Its update-bound calculation is host bookkeeping and may exceed 32 bits even when state registers fit.

During the discussion, an exact Python-integer simulation of the supplied rows checked inputs 0 through 50 against trial division, checked the update bound, and checked counter and flag invariants for inputs at least 2. NumPy was unavailable in that verification environment, so this was a simulation of the row recurrence, not execution of the NumPy implementation itself. This finite check supplements the reasoning; it is not the termination proof.

| Input | Prime? | Matrix updates |
| --- | --- | --- |
| 0 | No | 2 |
| 1 | No | 2 |
| 2 | Yes | 4 |
| 3 | Yes | 30 |
| 4 | No | 22 |
| 5 | Yes | 120 |
| 6 | No | 34 |
| 7 | Yes | 260 |
| 9 | No | 118 |

## 9. Suggested implementation sequence and open decisions

The detailed plan and milestone completion criteria are in [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md). The current sequence is:

1. Define the sparse artifact and an exact reference executor with checked 32-bit state and end detection.
2. Validate primitive matrix lowering, then parse/compile and visualize a device-free parity program.
3. Implement shared, nonrecursive functions with static invocation storage.
4. Link optional console input/output and the six-coordinate pixel port with no unused-device overhead.
5. Implement a WebAssembly executor and compare its full state/event traces against the reference backend.
6. Add explicitly recursive functions with bounded matrix-implemented frames and stack overflow handling.
7. Improve visualization, examples, replay, and measured execution/size reports.

This sequence is a proposal rather than completed work. Chevrotain is the selected parser toolkit; the plan also proposes CSR artifacts, a Rust WASM executor, and a Vite TypeScript page. No dependencies or scaffold have been installed yet. Concrete grammar details, transfer/scheduling circuits, bound verification, and frame layout are resolved and tested in their respective milestones.
