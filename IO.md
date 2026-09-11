# Console and RGB Display I/O

This proposal extends [DESIGN.md](DESIGN.md) with console character input/output and a 16-by-16 RGB display. It specifies devices and their compiler/runtime contract; it does not implement them. Syntax remains illustrative.

## 1. Principle: the matrix computes, the host observes

Output-only execution retains the same equation:

\[
x_{t+1} = \operatorname{ReLU}(W x_t).
\]

The matrix owns the output registers and the framebuffer. After each completed matrix update, the host observes designated coordinates and records any output events. It does not clear output flags, write pixel values into the machine, or replace `W`.

Interactive reads use the explicit input extension `x_next = relu(W*x + B*u)` described in Section 7. Both matrices remain fixed; only designated input ports receive external values. Output is deterministic given the initial state and recorded input deliveries. Real-time animation speed is a host scheduling choice, not part of program arithmetic.

There are two devices:

| Device | Matrix-owned state | Host action |
| --- | --- | --- |
| Console | Output payload/event, read request, and input latches | Append emitted characters and deliver queued characters to requested reads |
| Display | 768 color channels and a presentation bit | Snapshot and display a complete frame when an event occurs |

The browser's displayed image and accumulated console transcript are presentation state outside the machine. The authoritative drawing buffer remains inside the state vector.

## 2. Source-language API

### Types

Use these semantic types; their exact declaration syntax can follow the eventual grammar:

| Type | Values |
| --- | --- |
| `char` | One Unicode scalar value: `0..0x10FFFF`, excluding `0xD800..0xDFFF` |
| `u8` | An integer in `0..255` |
| `index16` | An integer in `0..15` |

All are represented by unsigned 32-bit integer coordinates under [RUNTIME.md](RUNTIME.md). The `char` restriction excludes surrogate code points; a character here is a scalar value, not necessarily a whole visible grapheme.

Invalid constants are compile-time errors. Converting dynamic natural numbers into these types inserts runtime checks unless the compiler proves the ranges. A failed check enters a defined runtime error state and produces no event or pixel write for that operation. Evaluation and validation finish before an operation commits.

There is no implicit wrapping of colors or coordinates. Explicit saturating conversion can be a library helper. On nonnegative inputs, clamping to a byte can be computed in stages using `z - relu(z - 255)`.

### Console

```text
console.putc(value: char)
console.readc() -> char
```

`putc` appends one character and returns after its emission step. Character literals compile to scalar values:

```text
console.putc('A');
console.putc('\n');
```

Convenience operations can be compiler/library features:

```text
console.write("Hello, matrix!");
console.println("Ready");
console.print_nat(counter);
```

Initially, `write` and `println` can accept string literals only: the compiler enumerates their scalar values and emits calls to the shared `putc` implementation. This does not require dynamic strings or an array type. `println` appends LF after its literal. Decimal conversion for `print_nat` is a matrix program, not formatting delegated to the browser.

Console output is an append-only text stream. LF separates lines. Control characters are not commands for cursor movement, terminal escape sequences, or HTML evaluation. The transcript preserves emitted scalar values; the UI may show normally invisible controls in an escaped inspection view.

`readc` consumes exactly one queued input scalar and returns it. If none is available, it blocks the whole sequential machine without advancing matrix ticks. Input is not automatically echoed to the output transcript; an echo program explicitly calls `putc`:

```text
fn main() {
    console.write("Type a line: ");
    let c = console.readc();
    while c != '\n' {
        console.putc(c);
        c = console.readc();
    }
    console.putc('\n');
    halt;
}
```

Comparison syntax is illustrative. If the input stream has been explicitly closed and its queue is empty, `readc` raises `ConsoleEndOfInput`. There is no sentinel character: NUL and every other valid scalar remain valid input. A result-returning read API may be added later if programs need to handle EOF without faulting.

### Display

```text
screen.set_pixel(px: index16, py: index16, r: u8, g: u8, b: u8)
screen.present()
```

`set_pixel` changes one pixel in the matrix-owned drawing buffer. `present` publishes a snapshot of that buffer as one complete visible frame. Drawing and presentation are distinct operations, so partially completed drawings do not automatically appear on screen.

Useful library operations include:

```text
screen.clear(r: u8, g: u8, b: u8)
screen.fill_rect(...)
screen.line(...)
```

Only `set_pixel` and `present` are required initially. `clear` can loop over all 256 pixels, with an optional later compiler optimization for broadcasting a color. Geometry helpers can also be ordinary functions; their signatures and clipping rules are not yet specified.

Coordinates have their origin at the top left. `px` increases rightward; `py` increases downward. RGB uses independent 8-bit channels, with zero black and `(255,255,255)` white. The host displays these as opaque sRGB bytes; there is no alpha channel in the machine's framebuffer.

### Example

```text
fn main() {
    console.println("Drawing a red diagonal");

    screen.clear(0, 0, 0);

    let i = 0;
    while i < 16 {
        // Checks may be discharged using the loop's range invariant.
        screen.set_pixel(index16(i), index16(i), 255, 0, 0);
        i = i + 1;
    }

    screen.present();
    console.println("Done");
    halt;
}
```

`index16(i)` illustrates a checked conversion; neither cast syntax nor the exact `halt` syntax is finalized. I/O routines follow the shared-function calling convention and can be used from regular or recursive functions. Observable effects execute in source order. Ordinary source-level `parallel` blocks should initially reject I/O calls, avoiding ambiguous event order; the compiler can still use parallel register updates internally.

## 3. Output register contract

The compiler exports a device manifest giving the coordinate indices and framebuffer layout. Names below describe the ABI; the actual indices depend on allocation.

| Register | Type | Meaning |
| --- | --- | --- |
| `io.console.codepoint` | `char` when emitting | Character payload |
| `io.console.emit` | `bit` | Emit one character at this completed update |
| `io.screen.rgb[0..767]` | `u8` | Persistent drawing buffer |
| `io.screen.present` | `bit` | Present the buffer at this completed update |

These are 771 device-state coordinates. This count excludes control states, argument registers, constants, runtime errors, and the temporary coordinates needed to implement operations. The display is optional: programs that do not use it need not reserve its buffer.

Console input adds a `read_request` output bit and three input-latch coordinates (`available`, `eof`, and `codepoint`), bringing the full device-state interface to 775 coordinates before compiler working storage. Programs that do not read input can omit those four coordinates. The input vector itself is external to this count.

The proposed channel layout is row-major, interleaved RGB:

```text
channel_index = 3 * (16 * py + px) + component
component: 0 = red, 1 = green, 2 = blue
```

The compiler maps these logical channel indices to vector coordinates, preferably as one contiguous region. Initial pixels are black, output bits are zero, and the browser initially shows a black display and an empty transcript. The character payload is irrelevant when `emit == 0`.

## 4. Events and instruction scheduling

An event belongs to a completed matrix update, identified by `(run_id, tick)`. The host observes every update once, even when it runs thousands of updates between browser paints. Observing only the final state of a batch would lose characters and presentation events.

`emit == 1` means one character at that tick. It is not a rising-edge detector: if two consecutive ticks legitimately contain emissions, both characters must be recorded. Similarly, each tick with `present == 1` requests a frame snapshot.

The compiler schedules an output instruction as follows:

1. Evaluate and validate its arguments.
2. Prepare its payload or finish its pixel writes while its event bit is zero.
3. Enter a commit phase that exposes the finished payload and the event bit in the same resulting state.
4. Continue execution and ensure the event bit returns to zero unless another event is deliberately being emitted.

The host never clears the event bit. Its matrix row is driven by emission/presentation control states, rather than an unconditional self-loop. Payload registers remain valid throughout the observation tick. The instruction may need multiple preparation phases; this is not a fixed four-update encoding.

Repeated debugger inspection of the same tick must not append another character. The runtime should centralize observation in the step operation, using event IDs to avoid duplicate delivery to views. A new run resets the transcript, displayed frame, and tick counter. Rewinding restores presentation state from event history or reconstructs it by replay, rather than emitting duplicate external effects.

If one tick contains both a console and display event, both use that tick's completed state. Event records use a fixed device order, console then display, to make traces reproducible. This low-level convention does not give source code concurrent I/O semantics.

### Halt, faults, and execution budgets

Source-level halt and runtime errors occur after any preceding completed output instructions have cleared their event bits. Terminal states have both event bits zero. This prevents repeated stepping of a halted machine from producing more output.

Halting does not implicitly present the drawing buffer or append a newline. A program must request those effects explicitly. Terminal states also have `read_request == 0`; they cannot issue new input requests.

When a host budget expires partway through an instruction, effects already committed remain in the transcript. Prepared but uncommitted console data produces no character. Partially updated drawing-buffer values remain invisible until a later `present`. Resuming a paused run continues from the saved state without repeating events.

## 5. Compiling pixel writes into a fixed matrix

The host does not execute an addressed pixel-write command on behalf of the program. It observes a framebuffer whose values the matrix updates itself.

### Selecting a pixel

For valid integer coordinates and pixel position `(j_x, j_y)`, a selector can be computed in stages:

\[
d_x=[px-j_x]_+ + [j_x-px]_+,\qquad
d_y=[py-j_y]_+ + [j_y-py]_+,
\]

\[
s_j=[1-d_x-d_y]_+.
\]

Exactly one `s_j` is one. Other selectors are zero. Constant positions use the permanent `one` coordinate for affine biases. Intermediate ReLUs and sums require separate scheduled phases.

Gate selection with the write control bit:

\[
m_j=[s_j+\text{writeActive}-1]_+.
\]

The same `m_j` selects all three channels of pixel `j`. There is no product of two changing coordinates.

### Replacing a selected channel

Let `F` be an existing channel, `v` the new channel, and `m` its write bit. With `0 <= F,v <= 255`:

\[
\text{keep}=[F-255m]_+,\qquad
\text{replacement}=[v-255(1-m)]_+,
\]

\[
F_{\text{next}}=\text{keep}+\text{replacement}.
\]

For `m == 0`, the result is `F`. For `m == 1`, it is `v`. The coefficient `255` multiplies a bit by a constant, so each intermediate expression is affine followed by ReLU. The final sum is another stage.

This is a dataflow construction, not a single matrix row for the whole replacement. The compiler must preserve the original channel and write arguments while calculating intermediates, then commit once. Between writes it must generate retention behavior. Scheduling/phase gating must prevent stale replacement intermediates from being applied repeatedly.

Bounds are essential. This replacement identity does not work for arbitrary unbounded register values.

### Size and runtime tradeoff

A parallel decoder and channel replacement network uses state proportional to the 256 pixels and 768 channels, in addition to the framebuffer. Its phase count can be independent of which pixel is selected. The exact coordinate count depends on scheduling and temporary reuse.

A serial scan over pixels can reuse some arithmetic machinery at the cost of additional updates; selection, storage access, and preservation still have to be compiled. Neither option should be advertised as having only 771 total coordinates.

The matrix remains fixed-size for a compiled program, but a dense representation of all its mostly-zero entries may be wasteful. A sparse row representation is a sensible implementation candidate. It computes the same recurrence and makes the cost depend on nonzero coefficients rather than every matrix entry. No sparse library has been chosen.

## 6. Browser integration

The compiler emits metadata rather than making the browser guess coordinate meanings:

```ts
interface OutputLayout {
  console?: {
    codepoint: number;
    emit: number;
    input?: {
      readRequest: number;
      available: number;
      eof: number;
      codepoint: number;
    };
  };
  screen?: {
    width: 16;
    height: 16;
    rgbStart: number; // contiguous, interleaved RGB in this manifest variant
    present: number;
  };
}
```

Register indices and dimensions are ordinary host numbers. Machine state uses unsigned 32-bit words, exposed through a `Uint32Array` view of WebAssembly memory. Stored values are exactly representable as JavaScript numbers; general weighted sums must use the checked accumulation model in [RUNTIME.md](RUNTIME.md). The host still validates character and color ranges before rendering.

The production loop may execute inside WebAssembly and return batched event records. It must inspect each completed update internally and stop at input boundaries; batching does not permit skipping event observation.

Conceptually, the step loop is:

```text
input = delivery_for_pending_read_or_zero()
// The call above suspends without advancing ticks if a read has no input.
state = matrix_relu_step(W, state, B, input)
tick += 1

if console.emit == 1:
    record_character(run_id, tick, console.codepoint)

if screen.present == 1:
    record_frame(run_id, tick, copy_of_rgb_buffer)

inspect_terminal_state()
if not_terminal and console.read_request == 1:
    record_pending_read(run_id, tick)
```

The frame must be a snapshot, not a reference into mutable machine storage. The browser can convert 768 RGB bytes into a 16-by-16 image with constant alpha 255 and enlarge it with nearest-neighbor sampling.

Console rendering treats the transcript as text. The host converts character scalar values to text rather than interpreting them as markup or terminal commands.

The execution engine observes every tick but need not repaint the page after every tick. It can batch console updates and paint the newest presented frame at the next browser paint. The logical event sequence still contains every presentation; trace mode should preserve that sequence or explicitly report a configured retention limit.

If frame-by-frame viewing is desired, the host may pause execution after each `present` until it is ready to advance. This changes wall-clock pacing without injecting data into the matrix or changing the next mathematical state. There is no wall-clock sleep primitive in this initial proposal.

The UI should distinguish the current internal drawing buffer, useful for debugging, from the last presented frame, which is the program's display output.

## 7. Blocking console input

Interactive input explicitly extends the autonomous machine. An unchanged initial state under a fixed recurrence cannot respond to characters chosen later by a user. Use fixed matrices `W` and `B`:

\[
x_{t+1}=\operatorname{ReLU}(W x_t+B u_t),
\]

Here `u_t` supplies a console delivery only at a requested read boundary and is zero at all other updates. The combined matrix `[W B]` is fixed: it acts on the concatenated program state and externally supplied input. This is an open system, not a claim that unpredictable input is generated by the autonomous matrix.

The host's role is supplying input data. Validation, returning from `readc`, branching on the returned character, and subsequent computation remain compiled matrix operations.

### Ports and input packets

| Coordinate/port | Meaning |
| --- | --- |
| `io.console.read_request` | The completed state requests one delivery before the next update |
| `io.console.input.available` | The next input latch contains a delivery |
| `io.console.input.eof` | This delivery signals a closed and exhausted input stream |
| `io.console.input.codepoint` | Character scalar when available and not EOF |

The external vector has three nonnegative integer entries:

```text
u = (available, eof, codepoint)

no delivery: (0, 0, 0)
character c: (1, 0, c)
end of input: (1, 1, 0)
```

NUL is `(1,0,0)`, distinct from no delivery and EOF. `B` routes these entries only to the corresponding input-latch rows. The `W` rows for those three latches are zero, so each latch reflects one delivery step and clears on the next zero-input step. Any value needed longer must be copied into ordinary program registers by the compiler's scheduled routine.

Input ports are not arbitrary writes into the program state. The runtime supplies nonzero input only for a pending read. Character encoding and packet validity are checked at the runtime boundary; the compiled read routine handles the available/EOF decision.

### Read lifecycle

1. The caller enters the shared `readc` routine. It preserves the caller's continuation under the ordinary calling convention and emits a `read_request` bit for one completed state. All input latches start clear.
2. The host observes the request once and marks a pending read. It has already recorded any character/frame output from that tick.
3. If a queued scalar exists, the host selects the oldest one. If the stream is closed and empty, it selects EOF. Otherwise it suspends execution with the program state and tick counter unchanged. The browser remains responsive.
4. To execute the next matrix update, the host supplies that packet through `u`. It atomically records the delivered packet and consumes the pending request as the step commits. The matrix advances into the receive phase, clears `read_request`, and fills the input latches through `B`.
5. Subsequent updates use zero input. The read routine consumes the previous state's latches, saves a valid character into its result register, and returns; EOF instead leads to `ConsoleEndOfInput`. Since all updates read old coordinates, the compiler must capture transient latches before they disappear or preserve them in bounded temporary registers while handling the branch.

The host must not take an ordinary zero-input step past a pending, undelivered read. This contract makes suspension a precise input boundary. It also prevents a request from being skipped when the engine executes batches of updates.

There is at most one outstanding request in the current sequential language. Recursion does not change this: suspended callers remain in their frames while the active call reads. A blocked read pauses screen computation as well; independent background animation would require a later concurrency or nonblocking-input design.

### Browser input behavior

The UI supplies an input queue of Unicode scalar values from committed text input. Pasted text is split by scalar values, not UTF-16 code units. Unpaired surrogates are rejected at the input boundary, and text is otherwise not normalized. Enter submits LF according to the console input widget's contract. Navigation keys and unfinished text-composition events do not enqueue characters.

Typing may queue characters before a program requests them. Reads consume the queue in order. Editing a draft in the input widget is distinct from program output; once text is submitted to the queue, it is input data, not an editable portion of the transcript.

Closing the input stream is an explicit host action or a property of a finite scripted input. The runtime drains queued characters before delivering EOF. An open, empty stream means wait, not EOF. Stopping a run cancels its pending read without inventing a character or EOF delivery.

Waiting consumes no matrix-update budget. A wall-clock cancellation policy, if configured by the host, is separate from a proof or budget on matrix updates.

### Replay

Record each delivered packet with the run ID, the request tick, and the delivery tick. Arrival time and how long a human took to type need not affect machine semantics. Replaying the same initial state and deliveries must reproduce the same matrix states and output events.

Checkpoint state includes the machine state/tick, pending-read status, input-stream closure/queue state, and the input/output event cursors. Restoring a checkpoint must not consume a character twice. During replay, use recorded deliveries and suspend or reject divergence if a request does not match the trace.

Other devices, asynchronous polling, a recoverable EOF result type, and nonblocking `try_readc` remain possible extensions. They are not required for blocking console input.

## 8. Validation criteria for implementation

When the compiler/runtime is implemented, meaningful behavioral checks include:

- Repeated equal characters are emitted separately and in order, including when ticks are executed in batches.
- Inspecting or pausing on an emission tick does not duplicate output; resume continues the same event history.
- A scalar outside the basic multilingual plane emits one scalar, rather than two surrogate events.
- Writing a pixel changes exactly its three channels; the other 255 pixels retain their values.
- Values at 0 and 255, and coordinates at both display edges, obey the same replacement behavior.
- Invalid dynamic arguments fault before committing a pixel write or character event.
- Drawing is invisible until presentation, and a presented frame remains unchanged by later buffer writes.
- Ordinary and recursive callers preserve call/return behavior across multi-update I/O routines.
- Halt produces no repeated events and does not implicitly present unfinished drawing.
- A pending read with no queued character freezes the machine tick and resumes with exactly one delivery.
- Queued and pasted text is consumed in scalar order; NUL, EOF, and absence of input are distinct.
- A read inside a recursive invocation returns to the correct caller with its saved locals intact.
- Closing an input stream drains queued characters before faulting an additional `readc` with `ConsoleEndOfInput`.
- Checkpoint/resume and replay do not lose or duplicate consumed characters.
- For a given initial state and input delivery sequence, batching and browser paint rate do not change the logical output sequence.

These are acceptance criteria, not tests claimed to exist or pass. The range-gated replacement formulas and event lifecycle should be validated before optimizing their matrix implementation.
