# Matrix Programming Language

An educational programming language that compiles programs into a fixed matrix applied repeatedly with ReLU:

\[
x_{t+1} = \operatorname{ReLU}(W x_t).
\]

The state vector holds data registers, control states, intermediate signals, and outputs. The matrix is the compiled program.

The intended implementation is TypeScript with Chevrotain for lexing/parsing and a browser interface for inspecting and visualizing execution.

The core browser workflow steps through multiplication, the signed output before ReLU, the output after ReLU, and committing the next state. Users can select a register/row to see its weighted contributions and follow source instructions and parallel branches. See [DEBUGGER.md](DEBUGGER.md).

The agreed runtime target uses 32-bit unsigned state, signed 32-bit matrix coefficients, and checked results computed with internal 64-bit accumulators. A WebAssembly backend will execute the sparse matrix-vector/ReLU loop; performance is not yet benchmarked.

Console output, console input, and the RGB screen are independently optional at compile time. Disabled or unused devices add no matrix coordinates or device-specific control states. Pure programs use initial arguments and ordinary return values without linking I/O devices.

Every program has an `end` output coordinate: nonzero terminates execution. An optional LED shows whether a selected existing coordinate is nonzero, adding no matrix storage. All gates are whole vector positions, not bits packed inside a number.

Structured parallel computations are first-class: branches advance together, keep separate mutable state, and join before the parent continues. Sequential call sites share a function body within their context; simultaneous calls may require separate matrix circuitry. Initial parallel branches perform computation, with console/screen I/O before or after the join.

See [DESIGN.md](DESIGN.md) for the discussion record: execution mechanics, language primitives, shared functions, explicit recursive functions, stack implementations, compiler architecture, and the original primality example.

See [IO.md](IO.md) for the end gate, LED, console character input/output, and six-coordinate RGB pixel-output port (`X, Y, R, G, B, emission_flag`). The browser retains the 16-by-16 screen image outside the matrix.

See [RUNTIME.md](RUNTIME.md) for the numeric model, the 32-bit versus 64-bit tradeoff, overflow semantics, and the proposed WebAssembly backend.

See [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) for the staged implementation plan, starting with an exact matrix executor and a source-to-matrix parity demo, then adding shared functions with structured parallel execution, optional I/O, WASM, and explicit recursion.

## Status

Design stage. This repository currently contains documentation; no parser, compiler, runtime, or web application has been implemented. Syntax examples are illustrative rather than a finalized grammar.
