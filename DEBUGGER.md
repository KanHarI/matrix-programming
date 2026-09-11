# Educational Execution and Debugging

Education is the primary product goal. Users should be able to follow how source code becomes a matrix and how each multiplication and ReLU changes the state. This view is part of the first browser demo, not a later visualization enhancement.

This is the full design contract. The initial UI now implements phase stepping, matrix/vector views, exact row inspection, source/context markers, and devices. History contains sampled summaries rather than restorable checkpoints; replay and breakpoints remain planned. See [IMPLEMENTATION.md](IMPLEMENTATION.md#runtime-and-debugging) for the shipped subset. This document complements [DESIGN.md](DESIGN.md), [IO.md](IO.md), and [RUNTIME.md](RUNTIME.md).

## 1. Show the complete update

For a program without interactive input, each update is:

\[
z_t = W x_t,\qquad y_t = \max(z_t,0),\qquad x_{t+1}=y_t.
\]

If console input is present, show `z_t = W*x_t + B*u_t` and the actual input packet for that update. Otherwise omit `B` and `u` entirely from the explanation.

The pre-ReLU vector `z_t` is signed and may contain negative values or values outside the 32-bit state range. Show it exactly. After ReLU, show the candidate `y_t`, then commit it only if it passes the runtime range checks. Neither preview is itself a committed machine state.

The main step control advances through these phases:

| Phase | What the user sees | Machine/device effects |
| --- | --- | --- |
| Current state | `x_t`, named registers, source/control context | The last committed state |
| Multiply | `W*x_t` or `W*x_t + B*u_t`, before ReLU | No tick advance, output emission, or input consumption |
| Apply ReLU | Side-by-side raw and rectified values; negatives become zero | Still a preview; range errors are highlighted |
| Commit update | Valid `y_t` becomes `x_(t+1)` | Advance one tick, deliver events once, then honor end/input requests |

The next cycle starts from that committed state. Preparing and inspecting one update never changes its input state halfway through. Repeatedly viewing a phase does not recompute it against different inputs or emit device output again.

The default control can be one button whose label changes to `Multiply`, `Apply ReLU`, and `Commit update`. Also provide a complete-matrix-update step, source-instruction step, run, pause, reset, and backward inspection. Faster controls may pass over intermediate views, but should leave an inspectable record according to the configured trace policy.

## 2. Make each number explainable

Show a register table with at least:

```text
Register   Current x   Before ReLU z   After ReLU y   Change / role
...
```

Use stable register names alongside coordinate indices. Distinguish ordinary values, constants, temporaries, control states, branch completion flags, the global end gate, and linked device positions. The physical storage is still a vector of whole 32-bit values; labels and grouping are metadata.

Selecting destination row `i` highlights the source coordinates and nonzero coefficients that contribute to it. Show the exact calculation:

```text
r_next = relu(1*a - 1*b + 1*one)

a = 2, b = 5, one = 1
weighted terms: 2 + (-5) + 1
before ReLU: -2
after ReLU:   0
```

The row explanation must be derived from the loaded matrix and captured state, not from a handwritten explanation that can drift from execution. Include `B*u` terms when present. Zero-weight entries can be hidden by default while remaining available in the matrix view.

Connect the displays: selecting a source register highlights its matrix column and affected destinations; selecting a destination highlights its row and weighted terms. Show numeric values and symbols as well as colors so the explanation does not depend on color alone.

Explicitly distinguish a value that was unchanged through retention from one that was clamped to zero by ReLU. Show the source location or compiler-generated phase responsible for a row, when available.

## 3. Source, instructions, and parallel branches

A source instruction may span several matrix updates. Display both the global committed tick and the current compiler phase, such as argument preparation, condition evaluation, branch transition, fork, join, or return. Do not imply that a matrix row always corresponds to a complete source statement.

For parallel computations, show each active context and its current source location, not one misleading global program counter. Show branches that are running, completed and holding a result, or waiting for nested work, and show the parent waiting at the join.

Selecting a branch changes the inspection focus only. A matrix update still advances every active branch. Instruction stepping for a selected branch runs whole global updates until that branch crosses an instruction boundary; other branches may advance or finish meanwhile. A row-contribution explanation can include shared constants, but must expose any actual cross-context coefficient rather than suggesting isolation that the matrix does not implement.

Local completion is distinct from program end. Demonstrate an early-finishing branch preserving its result while another continues, followed by a single join. Also show the function instance/context identity so users can see why sequential calls share circuitry and concurrent calls may need separate instances.

## 4. Preview and commit must stay separate

Console characters and pixel commands are delivered only when an update commits. If a preview contains an emission flag, label it as a pending event. Do not print the character or paint the pixel during multiplication or ReLU inspection.

The LED normally reflects committed state. If the UI also shows a candidate LED state, label it as a preview. A candidate nonzero end gate should visibly indicate that the next commit will terminate, without prematurely stopping or discarding the candidate's final output events.

On numeric overflow, display the raw sum and rectified value that failed, the allowed range, the destination register, and source location. Preserve the previous committed state and make Commit unavailable for that candidate. A value larger than `2^32-1` must remain visible exactly; converting it to a `Uint32Array` before displaying it would hide the error through truncation.

Input selected for a pending read is reserved for that candidate update and shown in the debugger. Do not consume it or record it as delivered until the update successfully commits. Input arriving while a preview is paused queues behind the reserved packet. Reset/cancel abandons the candidate without silently consuming its input.

## 5. History and replay

Record committed states, raw/candidate views or sufficient data to reconstruct them, compiler-phase metadata, input deliveries, and device events. Earlier ticks should be inspectable with the same before/after explanation. Checkpoints include the retained host screen and console/input state, or refer to replayable events that reconstruct them.

Viewing a historical tick is observation, not a second execution. Resuming from a historical checkpoint creates an explicit continuation/replay action with consistent input and output cursors. Recompilation creates a new artifact/run identity rather than mixing matrices within one history.

History uses an explicit memory/retention budget. Report which ticks are available; do not silently pretend that discarded history can still be inspected. For large matrices, use row selection, virtualized tables, and limited checkpoints instead of rendering or copying the entire trace on every repaint.

## 6. Runtime and WASM contract

Expose prepare/multiply, rectify/validate, and commit operations through the same runtime model used by complete-update and batch execution. A pending update binds the artifact version, committed state/tick, and reserved input packet. Invalid phase transitions are rejected.

The reference executor can retain exact `BigInt` preactivation values. WASM can expose signed 64-bit scratch values under the certified accumulation bound; preserve their exact values when presenting them in JavaScript. After-ReLU candidates must also retain enough width for overflow inspection before narrowing to committed 32-bit storage.

These scratch buffers and trace records are runtime/debugger memory, not additional coordinates in `x` or rows/columns in `W`. Enabling educational inspection, the LED, or history must not enlarge the program matrix. Fast execution may fuse loops and omit stored debug scratch when tracing is off, but must produce identical committed states, faults, and I/O events.

The WASM backend must support the phase inspector as well as batched execution. Acceleration must not make raw multiplication results inaccessible or replace mathematical explanation with opaque source execution.

## 7. Acceptance criteria

- A negative row result is shown before ReLU and exactly zero afterward.
- A positive result that fits the state range is unchanged by ReLU.
- Large terms that cancel show their exact signed products and correct sum.
- An overflowing rectified candidate is displayed without truncation and never committed.
- Every displayed row calculation agrees with the captured matrix/state/input and its raw output coordinate.
- Phase inspection leaves the committed tick, input queue, transcript, and screen unchanged until commit.
- A final emission and end in the same committed tick produce the output once, then stop.
- Parallel branches can be tracked together, including unequal completion times and the join.
- The reference and WASM phase views agree, as do phase-stepped and batched committed execution.
- Turning inspection/history on or off changes no matrix dimension, coefficients, or source semantics.

These are implementation requirements; no debugger or tests are claimed to exist yet.
