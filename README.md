# Matrix Programming Language

A language that compiles programs into a fixed matrix applied repeatedly with ReLU:

\[
x_{t+1} = \operatorname{ReLU}(W x_t).
\]

The state vector holds data registers, control states, intermediate signals, and outputs. The matrix is the compiled program.

The intended implementation is TypeScript with a Parsec-style parser-combinator library and a browser interface for inspecting and visualizing execution.

See [DESIGN.md](DESIGN.md) for the discussion record: execution mechanics, language primitives, shared functions, explicit recursive functions, stack implementations, compiler architecture, and the original primality example.

See [IO.md](IO.md) for proposed console character input/output and a matrix-owned 16-by-16 RGB display, including blocking reads, replayable input, output events, framebuffer updates, and browser integration.

## Status

Design stage. This repository currently contains documentation; no parser, compiler, runtime, or web application has been implemented. Syntax examples are illustrative rather than a finalized grammar.
