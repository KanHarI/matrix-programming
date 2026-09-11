# End Gate, LED, Console, and RGB Display I/O

This proposal extends [DESIGN.md](DESIGN.md) with a required end gate, an optional binary LED, console character input/output, and a 16-by-16 RGB display. It specifies gates/devices and their compiler/runtime contract; it does not implement them. Syntax remains illustrative.

These devices now work in the playground. [IMPLEMENTATION.md](IMPLEMENTATION.md#io)
describes the actual API: `read()` returns 4294967295 on EOF instead of the proposed
fault below; presets allow only their used devices. Unused peripherals allocate
no hardware. `print` currently expands literals in the compiler, not a source-level
printing library.

## 1. Principle: the matrix computes, the host observes

Output-only execution retains the same equation:

\[
x_{t+1} = \operatorname{ReLU}(W x_t).
\]

The matrix owns the output registers. After each completed matrix update, the host observes designated coordinates and records any output events. The screen receives addressed pixel emissions and retains its image in host/device memory outside the matrix. The host does not clear output flags, write pixel values back into the machine, or replace `W`.

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

The selected coordinate may be a result, counter, input, or other program register. It need not have type `bit`. The LED is a level display, not a pulse: it reflects the currently inspected state and remains at the final value after end. It needs no emission flag or reset protocol.

Binding the LED to an existing position is metadata only. It introduces no coordinate, matrix row/column, comparison circuitry, or execution phase. The host performs the nonzero test for display. A program may compute a dedicated indicator variable if desired, but that is an ordinary program value; observing it creates no further storage.

The LED is enabled by default when a binding is supplied, and can be toggled off or rebound in the UI without recompiling the matrix. With no binding it is absent; the runtime must not manufacture a register for it. When running quickly the UI may sample the latest state per repaint, so short pulses can be inspected in the trace/debugger but are not promised to be visually observable in real time.

The remaining user-facing devices are console and display, with the console split into independently selectable input and output capabilities:

| Device | Matrix-owned state | Host action |
| --- | --- | --- |
| Console | Output payload/event, read request, and input latches | Append emitted characters and deliver queued characters to requested reads |
| Display | `X, Y, R, G, B, emission_flag`: six coordinates | Update one pixel in the host-owned image per emission |

The browser's retained image and accumulated console transcript are device state outside the machine. The matrix produces commands for those devices. Pixel memory is not exposed as implicit working memory or readback for the program.

### Optional devices: no reserved hardware

Every peripheral capability is optional. Console and screen are linked at compile time; the LED is a read-only observation binding. The required end gate belongs to the core program. The compiler does not reserve a universal I/O area, a device bus, a global device-enable vector, or placeholder rows/columns. A disabled or unused peripheral contributes **zero coordinates, zero matrix entries, and zero device-specific control states**.

The initial capabilities and standard interface sizes are:

| Capability | Source operations | Device-state coordinates when linked |
| --- | --- | --- |
| Required `end` | Top-level return, `halt`, or explicit termination signal | 1 core binding; reuse the program's termination coordinate |
| `led` | Observe a selected coordinate's nonzeroness | 0 additional coordinates when bound to an existing register |
| `console.output` | `putc`, literal `write`/`println`, `print_nat` | 2: character payload and emission bit |
| `console.input` | `readc` | 4: request bit, available bit, EOF bit, character latch |
| `screen.rgb16` | `set_pixel`, drawing helpers | 6: X, Y, R, G, B, emission flag |
| No optional peripherals | Initial arguments, final result, required end | 0 peripheral coordinates beyond the core program |

These are interface sizes, not total compiler overhead. An included capability also needs the reachable routines, phase controls, arguments, and temporaries that implement its operations. That additional machinery must also disappear when the capability is absent. Console input does not pull in output, and console output does not pull in input. The screen requires neither.

The console/screen full-interface count is `2 + 4 + 6 = 12` words, excluding the core end coordinate and any ordinary result being observed by the LED. Each interface word uses the agreed 32-bit state representation, including emitted colors constrained to `0..255`. Sparse matrix indices, compiler/runtime metadata, and host pixel memory are not counted as state coordinates. This replaces the earlier full-framebuffer proposal, which would have stored `16*16*3 = 768` color coordinates inside the matrix.

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

`readc` consumes exactly one queued input scalar and returns it. If none is available, it blocks the whole machine without advancing matrix ticks. Reads are allowed before a parallel fork or after its join, not inside computational branches. Input is not automatically echoed to the output transcript; an echo program explicitly calls `putc`:

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
```

`set_pixel` prepares the five payload coordinates and emits one pixel command. The host updates that pixel and retains all others. Each emission replaces all three channels of the selected pixel together. The call returns after the emission commits; it does not wait for a browser repaint.

There is no `present` operation or seventh presentation coordinate in this interface. The screen is a stream of pixel writes, and partially completed drawings may be visible. Atomic frame presentation could be a separately designed future extension; it is not implied by these six coordinates.

Useful library operations include:

```text
screen.clear(r: u8, g: u8, b: u8)
screen.fill_rect(...)
screen.line(...)
```

Only `set_pixel` is a primitive device operation. `clear` emits 256 pixel writes through a shared routine; it has no dedicated clear register or host opcode. Lines and rectangles likewise compute and emit their pixels in matrix code. Their helper signatures and clipping rules are not yet specified.

Coordinates have their origin at the top left. `px` increases rightward; `py` increases downward. RGB uses independent 8-bit channels, with zero black and `(255,255,255)` white. The host displays these as opaque sRGB bytes; there is no alpha output coordinate.

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

    console.println("Done");
    halt;
}
```

`index16(i)` illustrates a checked conversion; neither cast syntax nor the exact `halt` syntax is finalized. I/O routines follow the shared-function calling convention and can be used from regular or recursive functions outside computational parallel branches. Observable effects execute in source order. Both atomic parallel-assignment blocks and structured parallel computations reject device I/O, including calls through effectful helpers. Compute independent results in parallel, join, then emit them in source order. Read-only LED observation remains allowed and adds no device instructions.

## 3. Output register contract

The compiler exports a device manifest giving coordinate indices and display dimensions. Names below describe the ABI; the actual indices depend on allocation.

| Register | Type | Meaning |
| --- | --- | --- |
| `end` | `nat` | Required: stop when nonzero |
| LED-selected existing register | Any stored nonnegative word | Optional: light when nonzero |
| `io.console.codepoint` | `char` when emitting | Character payload |
| `io.console.emit` | `bit` | Emit one character at this completed update |
| `io.screen.x` | `index16` when emitting | Pixel column |
| `io.screen.y` | `index16` when emitting | Pixel row |
| `io.screen.r` | `u8` when emitting | Red value |
| `io.screen.g` | `u8` when emitting | Green value |
| `io.screen.b` | `u8` when emitting | Blue value |
| `io.screen.emit` | Nonzero gate; compiler normally emits 0 or 1 | Emit this one pixel when nonzero |

If both console output and the screen are linked, their rows account for eight device-state coordinates, excluding the core end coordinate and the existing value observed by an LED. This count also excludes control states, argument registers, constants, runtime errors, and temporary coordinates needed to implement operations. The console/screen groups are independently optional; neither reserves space in artifacts that omit it.

Console input adds a `read_request` output bit and three input-latch coordinates (`available`, `eof`, and `codepoint`), bringing the full device-state interface to 12 coordinates before compiler working storage when all three capabilities are linked. A program that only reads characters needs those four interface coordinates, without the console-output pair or screen. The input vector itself is external to this count.

For example, the six screen positions may contain:

```text
X  Y   R    G  B  emission_flag
3  7  255   0  0       1
```

That completed update paints pixel `(3,7)` red. If the emission flag is zero, the host ignores all five payload coordinates and leaves the display unchanged. They may be prepared across multiple matrix updates without drawing incomplete commands. Output flags start at zero; the host initializes its image to black and its transcript to empty on a new run.

## 4. Events and instruction scheduling

An event belongs to a completed matrix update, identified by `(run_id, tick)`. The host observes every update once, even when it runs thousands of updates between browser paints. Observing only the final state of a batch would lose character and pixel events.

The console's emission bit being one means one character at that tick. The screen's emission coordinate being nonzero means one pixel at that tick. Neither is a rising-edge detector: consecutive emission ticks are separate events, even if the flag stays raised or the same pixel is written repeatedly. There is at most one pixel event per completed update from this single port; a source call may need multiple preparation updates.

The compiler schedules an output instruction as follows:

1. Evaluate and validate its arguments.
2. Prepare its payload while its emission coordinate is zero.
3. Enter a commit phase that exposes the finished payload and the event bit in the same resulting state.
4. Continue execution and ensure the event bit returns to zero unless another event is deliberately being emitted.

The host never clears the emission coordinate. Its matrix row is driven by emission control states, rather than an unconditional self-loop. Payload registers remain valid throughout the observation tick. The instruction may need multiple preparation phases; this is not a fixed four-update encoding.

The educational debugger may pause before ReLU or after ReLU but before commit. Those views do not emit characters/pixels, consume input, or trigger end. Display candidate gates as previews, and perform their effects only when the complete update commits. Reserve an input packet for a pending preview without consuming it until commit; see [DEBUGGER.md](DEBUGGER.md).

Repeated debugger inspection of the same tick must not append another character. The runtime should centralize observation in the step operation, using event IDs to avoid duplicate delivery to views. A new run resets the transcript, displayed frame, and tick counter. Rewinding restores presentation state from event history or reconstructs it by replay, rather than emitting duplicate external effects.

If one tick contains both a console and display event, both use that tick's completed state. Event records use a fixed device order, console then display, to make traces reproducible. This low-level convention does not give source code concurrent I/O semantics.

### Halt, faults, and execution budgets

After each successful update, observe the LED state and deliver any character/pixel events from that committed state, then check end. If end is nonzero, terminate before another update or input delivery. This permits a final output event and end in the same tick without losing that event. Output is observed exactly once per committed tick; a stopped machine does not emit it again just because its final state remains visible.

Halting does not emit prepared but uncommitted pixel payloads or append a newline. The host retains the image produced by committed pixel events. End takes priority over a simultaneous read request: that request is ignored and no character is consumed. The compiler should avoid generating competing requests, but the host's precedence is defined regardless.

Runtime faults, including numeric overflow before a candidate step commits, are separate abnormal stops. They do not require forcing the end coordinate nonzero or observing events from a failed update. The end rule describes normal termination from committed state.

When a host budget expires partway through an instruction, effects already committed remain in the transcript and retained image. Prepared but uncommitted payloads produce no character or pixel. Resuming a paused run continues from the saved state without repeating events.

## 5. Compiling pixel writes into a fixed matrix

The shared `set_pixel` routine evaluates and checks its five arguments, transfers them into the output payload coordinates, then raises the emission coordinate for the commit update. It clears that signal on continuation unless another emission is intended. The same six positions are reused by all call sites and all pixels.

Payload transfer and scheduling remain compiled affine/ReLU operations. The host only decodes the already-computed address and color and applies the output command. It does not execute source loops, choose colors, or change program registers.

The matrix needs no full-screen address decoder, per-pixel registers, or network that preserves 255 unselected pixels. Persistence of previous pixels is the output device's responsibility, just as the console retains previous characters.

The standard port uses six coordinates regardless of how many pixels have been emitted. Its compiled helper still needs control states and bounded transfer/checking temporaries, so six is the interface count rather than the entire implementation footprint. Disabled or unused display support removes both the port and its device-specific helpers.

With only these six coordinates, the program cannot read pixels back from the host or request atomic presentation of a group of writes. It must retain any image data it needs for later computation in its own explicit variables. Readback or frame boundaries would require separately specified extensions.

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
    x: number;
    y: number;
    r: number;
    g: number;
    b: number;
    emit: number;
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

if screen.emit != 0:
    record_and_apply_pixel(run_id, tick, screen.x, screen.y,
                          screen.r, screen.g, screen.b)

if state[endIndex] != 0:
    stop_with_final_state()
else if console.read_request == 1:
    record_pending_read(run_id, tick)
```

Pixel event records copy the five payload values at emission time; they must not retain references to the reusable matrix port. The host validates the address/color ranges, then updates its retained image at `(x,y)` with `(r,g,b)`. Compiled source checks should already guarantee valid commands; a malformed raw-matrix event is a device-protocol error, not a clamped or wrapped pixel address.

The host image may use 768 RGB bytes or 1,024 RGBA bytes with constant alpha 255. This is browser/device memory, not matrix coordinates. The browser may enlarge the 16-by-16 image using nearest-neighbor sampling. Its row-major array index is an implementation detail of the device renderer, not an affine operation the matrix must calculate.

Console rendering treats the transcript as text. The host converts character scalar values to text rather than interpreting them as markup or terminal commands.

The execution engine observes every tick but need not repaint the page after every tick. It applies pixel events in order to the retained image, then can repaint the latest image at the next browser paint. Batched rendering must not discard writes to different pixels or change the last-write-wins order for repeated writes to the same pixel. Trace mode should preserve the logical event sequence or explicitly report a configured retention limit.

The debugger may pause after each pixel emission to inspect drawing progress. This changes wall-clock pacing without injecting data into the matrix or changing the next mathematical state. There is no wall-clock sleep or frame-presentation primitive in this interface.

The UI can show the current six output positions alongside the retained screen image. Those are distinct: the port describes at most one command, while the image is the accumulated effect of prior emissions. Checkpoints must snapshot the device image or reconstruct it by replaying the pixel-event history; the matrix state alone does not contain the whole screen.

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
2. The host observes the request once and marks a pending read. It has already recorded any character/pixel output from that tick.
3. If a queued scalar exists, the host selects the oldest one. If the stream is closed and empty, it selects EOF. Otherwise it suspends execution with the program state and tick counter unchanged. The browser remains responsive.
4. To execute the next matrix update, the host supplies that packet through `u`. It atomically records the delivered packet and consumes the pending request as the step commits. The matrix advances into the receive phase, clears `read_request`, and fills the input latches through `B`.
5. Subsequent updates use zero input. The read routine consumes the previous state's latches, saves a valid character into its result register, and returns; EOF instead leads to `ConsoleEndOfInput`. Since all updates read old coordinates, the compiler must capture transient latches before they disappear or preserve them in bounded temporary registers while handling the branch.

The host must not take an ordinary zero-input step past a pending, undelivered read. This contract makes suspension a precise input boundary. It also prevents a request from being skipped when the engine executes batches of updates.

There is at most one outstanding request under the initial effect rules. Structured parallel computations are supported, but console reads/writes and screen emissions are rejected transitively inside their branches. A read therefore occurs before a fork or after a join, without sibling computations running concurrently. Recursion does not change this: suspended callers remain in their frames while the active call reads. Background animation during a blocked read would require a later concurrent-I/O or nonblocking-input extension, not just computational fork/join.

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
- A pixel emission changes exactly the selected host-image pixel; the other 255 pixels retain their values.
- Values at 0 and 255, and coordinates at both display edges, obey the same write behavior.
- Invalid dynamic arguments fault before committing a pixel write or character event.
- Changing any payload coordinate while emission is zero leaves the screen unchanged.
- Consecutive nonzero emission ticks produce distinct pixel events, and repeated writes to one pixel preserve source order.
- Ordinary and recursive callers preserve call/return behavior across multi-update I/O routines.
- Parallel branches reject direct and indirect device calls, while sequential I/O after a join receives both completed results in declaration order.
- End values of 1, 2, and the unsigned maximum all stop execution; zero alone permits continuing.
- No batch runs an additional matrix update after end is observed, and an initially nonzero end stops before the first update.
- A final console/pixel event is delivered once if committed with end; a simultaneous read request consumes no input.
- Halt produces no repeated events and does not emit a prepared payload whose emission coordinate is zero.
- A pending read with no queued character freezes the machine tick and resumes with exactly one delivery.
- Queued and pasted text is consumed in scalar order; NUL, EOF, and absence of input are distinct.
- A read inside a recursive invocation returns to the correct caller with its saved locals intact.
- Closing an input stream drains queued characters before faulting an additional `readc` with `ConsoleEndOfInput`.
- Checkpoint/resume and replay do not lose or duplicate consumed characters.
- For a given initial state and input delivery sequence, batching and browser paint rate do not change the logical output sequence.

These are acceptance criteria, not tests claimed to exist or pass. Validate payload preparation, emission timing, retained-image behavior, and replay before optimizing their implementations.

Device-linking acceptance criteria additionally include:

- Compiling the same device-free parity checker with all toggles off or with unused capabilities enabled yields the same machine state layout and recurrence, apart from non-executable build metadata.
- Uncalled library functions containing I/O do not increase its matrix dimension or nonzero count.
- An input-only program has no output emission/payload pair; an output-only program has no read request, input latches, or `B`.
- A program without the screen has none of its six output coordinates or device-specific phases/helpers.
- Screen support reuses six interface coordinates for all 256 pixels and allocates no implicit matrix framebuffer.
- Calling a disabled device reports a compile-time error instead of silently omitting the operation or enabling hardware.
- All eight combinations of the three capabilities produce manifests and runtimes consistent with their actual reachable device usage.
- Every artifact includes a valid end binding without introducing a second redundant halt register.
- Enabling, disabling, or rebinding an LED observer changes no matrix dimensions, coefficients, or state values.
- An LED bound to values 0, 1, 2, and the unsigned maximum displays off, on, on, and on; it does not test a packed binary bit.
