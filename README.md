# Matrix Programming Language

A language that compiles programs into a fixed matrix applied repeatedly with ReLU:

\[
x_{t+1} = \operatorname{ReLU}(W x_t).
\]

The state vector holds data registers, control states, intermediate signals, and outputs. The matrix is the compiled program.

The intended implementation is TypeScript with a Parsec-style parser-combinator library and a browser interface for inspecting and visualizing execution.

The agreed runtime target uses 32-bit unsigned state, signed 32-bit matrix coefficients, and checked results computed with internal 64-bit accumulators. A WebAssembly backend will execute the sparse matrix-vector/ReLU loop; performance is not yet benchmarked.

Console output, console input, and the RGB screen are independently optional at compile time. Disabled or unused devices add no matrix coordinates or device-specific control states. Pure programs use initial arguments and ordinary return values without linking I/O devices.

Every program has an `end` output coordinate: nonzero terminates execution. An optional LED shows whether a selected existing coordinate is nonzero, adding no matrix storage. All gates are whole vector positions, not bits packed inside a number.

See [DESIGN.md](DESIGN.md) for the discussion record: execution mechanics, language primitives, shared functions, explicit recursive functions, stack implementations, compiler architecture, and the original primality example.

See [IO.md](IO.md) for the end gate, LED, console character input/output, and six-coordinate RGB pixel-output port (`X, Y, R, G, B, emission_flag`). The browser retains the 16-by-16 screen image outside the matrix.

See [RUNTIME.md](RUNTIME.md) for the numeric model, the 32-bit versus 64-bit tradeoff, overflow semantics, and the proposed WebAssembly backend.

See [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) for the staged implementation plan, starting with an exact matrix executor and a source-to-matrix parity demo, then adding shared functions, optional I/O, WASM, and explicit recursion.

## Status

Design stage. This repository currently contains documentation; no parser, compiler, runtime, or web application has been implemented. Syntax examples are illustrative rather than a finalized grammar.
