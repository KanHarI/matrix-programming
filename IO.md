# End Gate, LED, Console, and RGB Display I/O

This proposal extends [DESIGN.md](DESIGN.md) with a required end gate, an optional binary LED, console character input/output, and a 16-by-16 RGB display. It specifies gates/devices and their compiler/runtime contract; it does not implement them. Syntax remains illustrative.

## 1. Principle: the matrix computes, the host observes

Output-only execution retains the same equation:

\[
x_{t+1} = \operatorname{ReLU}(W x_t).
\]

The matrix owns the output registers and the framebuffer. After each completed matrix update, the host observes designated coordinates and records any output events. It does not clear output flags, write pixel values into the machine, or replace `W`.

Interactive reads use the explicit input extension `x_next = relu(W*x + B*u)` described in Section 7. Both matrices remain fixed; only designated input ports receive external values. Output is deterministic given the initial state and recorded input deliveries. Real-time animation speed is a host scheduling choice, not part of program arithmetic.

### Gates are whole vector positions

Every gate or payload is a whole 32-bit coordinate of the state vector. Earlier references to a `bit` mean a coordinate constrained to the values zero and one; they do not mean a bit packed inside another number. There is no status-word bitmask to unpack.

The state produced by each matrix update is also the vector the runtime observes. A manifest assigns output meanings to positions; it does not require a second copied output vector or fixed positions common to every program. For example:

```text
position:      0       1       2       3       4
meaning:       n       d       r     answer   end
value:        10       2       0       1       1
                                      |       |
                                   LED on   stop
```

These indices and values are illustrative. The LED reads the complete value at position 3, and termination reads the complete value at position 4. `2`, `42`, and `4,294,967,295` are all nonzero for either gate, not just values with their lowest binary bit set.

### Required end gate

Every compiled program identifies one state coordinate as `end`. The rule is `state[endIndex] != 0` means execution has terminated; zero means execution may continue. The end gate is a required part of the core program interface, not a toggleable peripheral.

The compiler normally initializes it to zero and sets it to one for a top-level return or `halt`. A return from an ordinary helper or recursive invocation routes control to its caller and must not set the program end gate. The external gate accepts any nonzero word even if compiler-generated termination normally uses one.

The end position can reuse the compiler's existing termination register; it is not an additional wrapper around a separate mandatory halt flag. Its binding must not alias a temporary control flag that becomes nonzero before the program actually finishes. Infinite-running programs still have the end binding, but may leave it zero forever.

The runtime checks end on initial state and after every committed update. Once nonzero, it freezes that committed state and schedules no further matrix updates, even if a larger batch budget remains. Repeated debugger inspection does not resume execution or re-emit events. If initial end is already nonzero, no matrix update runs; the initial LED state may still be displayed.

This replaces the earlier proposal that every halted machine must itself become a mathematical fixed point. Stable final state is enforced by stopping the runtime; the compiler need not add circuitry to make every row absorbing.

### Optional binary LED

An LED binding identifies a state coordinate to observe:

```text
LED off: state[ledIndex] == 0
LED on:  state[ledIndex] != 0
```

The selected coordinate may be a result, counter, input, or other program register. It need not have type `bit`. The LED is a level display, not a pulse: it reflects the currently inspected state and remains at the final value after end. It needs no emission flag, reset protocol, or `present` call.

Binding the LED to an existing position is metadata only. It introduces no coordinate, matrix row/column, comparison circuitry, or execution phase. The host performs the nonzero test for display. A program may compute a dedicated indicator variable if desired, but that is an ordinary program value; observing it creates no further storage.

The LED is enabled by default when a binding is supplied, and can be toggled off or rebound in the UI without recompiling the matrix. With no binding it is absent; the runtime must not manufacture a register for it. When running quickly the UI may sample the latest state per repaint, so short pulses can be inspected in the trace/debugger but are not promised to be visually observable in real time.

The remaining user-facing devices are console and display, with the console split into independently selectable input and output capabilities:

| Device | Matrix-owned state | Host action |
| --- | --- | --- |
| Console | Output payload/event, read request, and input latches | Append emitted characters and deliver queued characters to requested reads |
| Display | 768 color channels and a presentation bit | Snapshot and display a complete frame when an event occurs |

The browser's displayed image and accumulated console transcript are presentation state outside the machine. The authoritative drawing buffer remains inside the state vector.

### Optional devices: no reserved hardware

Every peripheral capability is optional. Console and screen are linked at compile time; the LED is a read-only observation binding. The required end gate belongs to the core program. The compiler does not reserve a universal I/O area, a device bus, a global device-enable vector, or placeholder rows/columns. A disabled or unused peripheral contributes **zero coordinates, zero matrix entries, and zero device-specific control states**.

The initial capabilities and standard interface sizes are:

| Capability | Source operations | Device-state coordinates when linked |
| --- | --- | --- |
| Required `end` | Top-level return, `halt`, or explicit termination signal | 1 core binding; reuse the program's termination coordinate |
| `led` | Observe a selected coordinate's nonzeroness | 0 additional coordinates when bound to an existing register |
| `console.output` | `putc`, literal `write`/`println`, `print_nat` | 2: character payload and emission bit |
| `console.input` | `readc` | 4: request bit, available bit, EOF bit, character latch |
| `screen.rgb16` | `set_pixel`, `present`, drawing helpers | 769: 768 RGB channels and presentation bit |
| No optional peripherals | Initial arguments, final result, required end | 0 peripheral coordinates beyond the core program |

These are interface sizes, not total compiler overhead. An included capability also needs the reachable routines, phase controls, arguments, and temporaries that implement its operations. That additional machinery must also disappear when the capability is absent. Console input does not pull in output, and console output does not pull in input. The screen requires neither.

The console/screen full-interface count remains `2 + 4 + 769 = 775` words, excluding the core end coordinate and any ordinary result being observed by the LED. Each interface word uses the agreed 32-bit state representation, including channels constrained to `0..255`. Sparse matrix indices and compiler/runtime metadata are not counted as state coordinates.

### Enablement and linking

Expose independent build-time toggles in the web page or compiler options. An illustrative configuration is:

```ts
const devices = {
  consoleOutput: false,
  consoleInput: false,
  rgb16Display: false,
};
```

The three console/screen capabilities default to disabled. Enabling one permits source code to use it; it does not allocate that device when the program never references it through reachable code. End is always bound. LED enablement is independent metadata, normally on when a register has been selected.

The compiler performs reachability analysis from the program entry point, follows ordinary and recursive calls, and links only the device operations that remain reachable. Merely importing a library with unused printing or drawing functions must not allocate their devices. The guarantee concerns unused reachable-code dependencies, not general proof that a dynamically controlled branch can never execute.

A reachable call to a disabled capability is a compile-time error identifying the call and required toggle. The compiler must not silently delete that effect or implicitly enable other devices. An enabled but unused capability is omitted and reported as unused. Compiler reports should distinguish allowed capabilities from those actually linked into the matrix.

Changing a console/screen capability toggle changes compilation configuration. Recompile and start a new run; do not resize or modify `W` during an existing run. Hiding a console/display panel is a separate UI action that does not disable the device or shrink the matrix. The read-only LED toggle needs no recompilation. Checkpoints and traces must identify the compiled artifact and its linked device layout; LED viewing preferences do not affect machine replay.

### Minimal programs and final results

A parity checker can receive its number as an initial argument and expose its answer through its normal return value:

```text
fn main(n: nat) -> bit {
    let remainder = n;
    while remainder >= 2 {
        remainder = remainder - 2;
    }
    return equal(remainder, 0);
}
```

This illustrative program needs no console or screen capabilities. Its input is placed in an ordinary argument register before execution. Its top-level return commits the answer and raises end. Binding the LED to the ordinary result register shows even as on and odd as off without allocating any extra coordinate. End must be separate from that Boolean answer: an odd result is zero but the program must still terminate.

Arguments, result registers, and the program's own termination/control state are part of its computation, not a peripheral ABI. The compiler should reuse/map ordinary registers where valid, rather than adding a universal device wrapper to every program.

For such a program, execution is simply `relu(W*x)` with the required end check. There is no input matrix `B` to allocate, no input packet/latches, no console/screen event positions, and no framebuffer. Debugger labels, LED binding, register inspection, and host-side result display are metadata/observation features and do not require extra coordinates.

### Compilation contract

Determine device dependencies before device-register allocation and matrix emission:

```text
entry-point reachability
  -> required device operations
  -> validate against enabled capabilities
  -> link only required routines and device state
  -> schedule and allocate the compact state vector
  -> emit W, optional B, and optional device metadata
```

Only console input currently requires `B`; output-only or peripheral-free artifacts omit it. A runtime may share host code across device combinations, but it must dispatch from metadata without allocating absent ports inside the machine. Every execution path checks end. A peripheral-free path needs no console/screen polling; an optional LED observation adds no matrix computation. There is no fixed gap in register numbering where an excluded peripheral would have been.

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
| `end` | `nat` | Required: stop when nonzero |
| LED-selected existing register | Any stored nonnegative word | Optional: light when nonzero |
| `io.console.codepoint` | `char` when emitting | Character payload |
| `io.console.emit` | `bit` | Emit one character at this completed update |
| `io.screen.rgb[0..767]` | `u8` | Persistent drawing buffer |
| `io.screen.present` | `bit` | Present the buffer at this completed update |

If both console output and the screen are linked, their rows account for 771 device-state coordinates, excluding the core end coordinate and the existing value observed by an LED. This count also excludes control states, argument registers, constants, runtime errors, and the temporary coordinates needed to implement operations. The console/screen groups are independently optional; neither reserves space in artifacts that omit it.

Console input adds a `read_request` output bit and three input-latch coordinates (`available`, `eof`, and `codepoint`), bringing the full device-state interface to 775 coordinates before compiler working storage when all three capabilities are linked. A program that only reads characters needs those four interface coordinates, without the console-output pair or screen. The input vector itself is external to this count.

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

After each successful update, observe the LED state and deliver any character/frame events from that committed state, then check end. If end is nonzero, terminate before another update or input delivery. This permits a final output event and end in the same tick without losing that event. Output is observed exactly once per committed tick; a stopped machine does not emit it again just because its final state remains visible.

Halting does not implicitly present the drawing buffer or append a newline. A program must request those effects explicitly. End takes priority over a simultaneous read request: that request is ignored and no character is consumed. The compiler should avoid generating competing requests, but the host's precedence is defined regardless.

Runtime faults, including numeric overflow before a candidate step commits, are separate abnormal stops. They do not require forcing the end coordinate nonzero or observing events from a failed update. The end rule describes normal termination from committed state.

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
interface IOLayout {
  end: number; // required vector index; value != 0 stops execution
  led?: {
    register: number; // existing vector index, not a bit offset
    enabled: boolean;
  };
  console?: {
    output?: {
      codepoint: number;
      emit: number;
    };
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

Absent peripherals have absent manifest entries, not zero-filled device registers. The `console` object is omitted when neither direction is linked. Every artifact retains its required `end` binding; a minimal artifact can contain just that index, normal argument/result metadata, and an optional LED binding. This shape permits input-only programs without implicitly allocating console output.

Register indices and dimensions are ordinary host numbers. Machine state uses unsigned 32-bit words, exposed through a `Uint32Array` view of WebAssembly memory. Stored values are exactly representable as JavaScript numbers; general weighted sums must use the checked accumulation model in [RUNTIME.md](RUNTIME.md). The host still validates character and color ranges before rendering.

The production loop may execute inside WebAssembly and return batched event records. It must inspect each completed update internally and stop at input boundaries; batching does not permit skipping event observation.

Before entering the loop, inspect initial LED state and stop immediately if initial end is nonzero. For an artifact with all three console/screen capabilities, a conceptual committed step is:

```text
input = delivery_for_pending_read_or_zero()
// The call above suspends without advancing ticks if a read has no input.
state = matrix_relu_step(W, state, B, input)
tick += 1

if led.enabled:
    observe_led(state[led.register] != 0)

if console.emit == 1:
    record_character(run_id, tick, console.codepoint)

if screen.present == 1:
    record_frame(run_id, tick, copy_of_rgb_buffer)

if state[endIndex] != 0:
    stop_with_final_state()
else if console.read_request == 1:
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
- End values of 1, 2, and the unsigned maximum all stop execution; zero alone permits continuing.
- No batch runs an additional matrix update after end is observed, and an initially nonzero end stops before the first update.
- A final console/frame event is delivered once if committed with end; a simultaneous read request consumes no input.
- Halt produces no repeated events and does not implicitly present unfinished drawing.
- A pending read with no queued character freezes the machine tick and resumes with exactly one delivery.
- Queued and pasted text is consumed in scalar order; NUL, EOF, and absence of input are distinct.
- A read inside a recursive invocation returns to the correct caller with its saved locals intact.
- Closing an input stream drains queued characters before faulting an additional `readc` with `ConsoleEndOfInput`.
- Checkpoint/resume and replay do not lose or duplicate consumed characters.
- For a given initial state and input delivery sequence, batching and browser paint rate do not change the logical output sequence.

These are acceptance criteria, not tests claimed to exist or pass. The range-gated replacement formulas and event lifecycle should be validated before optimizing their matrix implementation.

Device-linking acceptance criteria additionally include:

- Compiling the same device-free parity checker with all toggles off or with unused capabilities enabled yields the same machine state layout and recurrence, apart from non-executable build metadata.
- Uncalled library functions containing I/O do not increase its matrix dimension or nonzero count.
- An input-only program has no output emission/payload pair; an output-only program has no read request, input latches, or `B`.
- A program without the screen has no RGB coordinates, pixel decoder, display-specific phases, or presentation bit.
- Calling a disabled device reports a compile-time error instead of silently omitting the operation or enabling hardware.
- All eight combinations of the three capabilities produce manifests and runtimes consistent with their actual reachable device usage.
- Every artifact includes a valid end binding without introducing a second redundant halt register.
- Enabling, disabling, or rebinding an LED observer changes no matrix dimensions, coefficients, or state values.
- An LED bound to values 0, 1, 2, and the unsigned maximum displays off, on, on, and on; it does not test a packed binary bit.
