import parity from '../examples/parity.matrix?raw';
import matrixComputer from '../examples/matrix-computer.matrix?raw';
import primeSimple from '../examples/prime-simple.matrix?raw';
import primeOptimized from '../examples/prime-optimized.matrix?raw';
import primeBinary from '../examples/prime-binary.matrix?raw';
import hello from '../examples/hello.matrix?raw';
import greeting from '../examples/greeting.matrix?raw';
import parallel from '../examples/parallel.matrix?raw';
import recursiveFactorial from '../examples/recursive-factorial.matrix?raw';

export interface Example { id: string; name: string; description: string; source: string; inputs: Record<string, number> }
export const examples: Example[] = [
  { id: 'parity', name: 'Parity checker · 6 × 6', description: 'A six-coordinate countdown matrix. Result / LED 1 means even; 0 means odd. Takes floor(n / 2) + 2 updates.', source: parity, inputs: { n: 42 } },
  { id: 'matrix-computer', name: 'Matrix computer · parity walkthrough', description: 'A Matrix-language program simulates the 6 × 6 parity machine and prints W, x, signed W x, and ReLU after every inner tick. Starts at 4; try 5. The outer simulator matrix is larger and slower than the inner six-coordinate circuit.', source: matrixComputer, inputs: { n: 4 } },
  { id: 'prime-simple', name: 'Primality · original algorithm', description: 'The original counter-and-reset method, compiled from source into a fixed matrix.', source: primeSimple, inputs: { n: 6 } },
  { id: 'prime-optimized', name: 'Primality · optimized', description: 'Odd trial divisors, doubling-based remainders, and square increments advanced by 8—no repeated squaring or multiplication.', source: primeOptimized, inputs: { n: 97 } },
  { id: 'prime-binary', name: 'Primality · binary division', description: 'Binary long division scans 32 bits per remainder using fixed scalar storage. Faster for large quotients; more overhead for small inputs. Squares still advance by addition.', source: primeBinary, inputs: { n: 4294967295 } },
  { id: 'hello', name: 'Hello, world! + pixels', description: 'Print text and draw an H on the 16 × 16 screen, one six-port pixel event at a time.', source: hello, inputs: {} },
  { id: 'greeting', name: 'Interactive greeting', description: 'Read a name until Enter, retain up to 64 Unicode characters, and print a personalized greeting.', source: greeting, inputs: {} },
  { id: 'parallel', name: 'Parallel countdowns', description: 'Two independent computations advance together and join before main returns.', source: parallel, inputs: { n: 8 } },
  { id: 'recursive-factorial', name: 'Recursive factorial', description: 'Direct self recursion with 16 fixed activation banks. Starts at 5! = 120. Values 0–12 fit in u32; larger products or excess recursion depth fault without wrapping.', source: recursiveFactorial, inputs: { n: 5 } },
];
