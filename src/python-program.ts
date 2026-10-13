import type { Artifact } from './core/types';

// Characters a Python source file cannot hold verbatim: line breaks inside a
// comment, other controls, and lone UTF-16 surrogates (not encodable as UTF-8).
const UNSAFE = /[\u0000-\u0008\u000a-\u001f\u007f-\u009f\u2028\u2029\ufeff]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;
const WIDTH = 88;

const comment = (text: string) => text.replace(UNSAFE, '\ufffd');
const hex = (code: number, digits: number) => code.toString(16).padStart(digits, '0');

/** A Python string literal that reproduces any JavaScript string, lone surrogates included. */
export function pythonString(text: string): string {
  const quote = text.includes("'") && !text.includes('"') ? '"' : "'";
  let literal = quote;
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (char === '\\' || char === quote) literal += `\\${char}`;
    else if (!char.replace(UNSAFE, '')) literal += code <= 0xff ? `\\x${hex(code, 2)}` : `\\u${hex(code, 4)}`;
    else literal += char;
  }
  return literal + quote;
}

/** `NAME = [...]` on one line when it fits, otherwise wrapped four spaces deep. */
function assignList(name: string, values: string[]): string {
  const inline = `${name} = [${values.join(', ')}]`;
  if (inline.length <= WIDTH) return inline;
  const lines: string[] = [];
  let line = '';
  for (const value of values) {
    if (line && line.length + value.length + 2 > WIDTH - 4) { lines.push(`    ${line}`); line = ''; }
    line += `${value}, `;
  }
  if (line) lines.push(`    ${line}`);
  return `${name} = [\n${lines.map(text => text.trimEnd()).join('\n')}\n]`;
}

const indent = (lines: string[], spaces: number) => lines.map(line => (line ? ' '.repeat(spaces) + line : line));

/**
 * A standalone Python 3 script that runs the compiled matrix until its end gate,
 * with the same bound, fault and device-port checks as Machine. W stays data; the
 * host loop only multiplies, rectifies, commits and moves port values.
 */
export function pythonProgram(artifact: Artifact, defaults: Record<string, number> = {}): string {
  const size = artifact.rows.length;
  if (artifact.registers.length !== size || artifact.initial.length !== size) throw new Error('Matrix rows and register dimensions must match');
  // A device this script cannot model would silently change the program's meaning.
  const unsupported = Object.keys(artifact.devices).filter(device => !['consoleOutput', 'consoleInput', 'screen'].includes(device));
  if (unsupported.length) throw new Error(`Python export does not support the ${unsupported.join(', ')} device yet`);
  const { consoleOutput: output, consoleInput: input, screen } = artifact.devices;
  const nonzero = artifact.rows.reduce((total, row) => total + row.cols.length, 0);
  const parameters = Object.entries(artifact.inputs).map(([name, index]) => ({ name, index, value: defaults[name] ?? artifact.initial[index]! }));
  const title = comment(artifact.name).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const example = ['python3 program.py', ...parameters.map(parameter => parameter.value)].join(' ');
  const devices = [output && 'writes console output to stdout', input && 'reads console input from stdin', screen && 'draws the 16 × 16 screen'].filter(Boolean);

  const header = String.raw`#!/usr/bin/env python3
"""${title}, compiled by Matrix Lab into one fixed matrix W.

W is ${size} × ${size} with ${nonzero} nonzero weights. Running the program means
repeating x <- ReLU(W x) until the end coordinate of x is nonzero. W performs all
of the computation: this script only multiplies, applies ReLU, checks each
coordinate's bound${devices.length ? ', and moves values through the I/O ports' : ''}. Python integers keep every sum exact.${devices.length ? `\n\nIt ${devices.join(', ').replace(/, ([^,]*)$/, ' and $1')}.` : ''}

Run it with: ${example}
"""

import argparse
import sys
from itertools import compress
from operator import gt`;

  const source = artifact.source.replace(/\s+$/, '').split(/\r\n|\r|\n/).map(line => `#   ${comment(line)}`.trimEnd());
  const rows = artifact.rows.map((row, i) => {
    if (row.cols.length !== row.weights.length) throw new Error(`Malformed sparse matrix row ${i}`);
    const entries = row.cols.map((col, k) => `(${col}, ${row.weights[k]})`).join(', ');
    return `    [${entries}],  # ${i} ${comment(artifact.registers[i]!.name)}`;
  });
  const dictionary = (pairs: [string, number][]) => `{${pairs.map(([name, value]) => `${pythonString(name)}: ${value}`).join(', ')}}`;
  const ports = [
    output && `OUT_CODEPOINT, OUT_EMIT = ${output.codepoint}, ${output.emit}  # console output port`,
    input && `IN_REQUEST, IN_AVAILABLE, IN_EOF, IN_CODEPOINT = ${input.request}, ${input.available}, ${input.eof}, ${input.codepoint}  # console input port`,
    screen && `PX_X, PX_Y, PX_R, PX_G, PX_B, PX_EMIT = ${screen.x}, ${screen.y}, ${screen.r}, ${screen.g}, ${screen.b}, ${screen.emit}  # screen port`,
  ].filter((line): line is string => Boolean(line));
  const faults = artifact.faults ?? [];
  const data = [
    '# Matrix source:',
    '#',
    ...source,
    '',
    `# Row i of W as (column, weight) pairs; every other entry is 0.`,
    size ? `W = [\n${rows.join('\n')}\n]` : 'W = []',
    '',
    '# Coordinate names, inclusive upper bounds, and the initial state x_0.',
    assignList('NAMES', artifact.registers.map(register => pythonString(register.name))),
    assignList('BOUNDS', artifact.registers.map(register => String(register.bound))),
    assignList('INITIAL', artifact.initial.map(String)),
    `INPUTS = ${dictionary(parameters.map(parameter => [parameter.name, parameter.index]))}  # main's parameters -> coordinate`,
    `DEFAULTS = ${dictionary(parameters.map(parameter => [parameter.name, parameter.value]))}`,
    `END = ${artifact.end}  # execution ends once x[END] != 0`,
    `RESULT = ${artifact.result ?? 'None'}  # main's return value`,
    faults.length ? `FAULTS = [  # (coordinate, message): a nonzero coordinate stops the machine\n${faults.map(fault => `    (${fault.register}, ${pythonString(fault.message)}),`).join('\n')}\n]` : 'FAULTS = []  # (coordinate, message): a nonzero coordinate stops the machine',
    ...ports,
  ].join('\n');

  const checks = [
    output && String.raw`if x[OUT_EMIT] and not is_scalar(x[OUT_CODEPOINT]):
    raise Fault('Console output is not a valid Unicode scalar value', ticks)`,
    screen && String.raw`if x[PX_EMIT] and (x[PX_X] > 15 or x[PX_Y] > 15 or max(x[PX_R], x[PX_G], x[PX_B]) > 255):
    raise Fault('Pixel output is outside the 16×16 RGB display bounds', ticks)`,
  ].filter((block): block is string => Boolean(block));
  const machine = [
    String.raw`# W x is a sum of W's columns weighted by x, so only nonzero coordinates contribute.
COLUMNS = [[] for _ in W]
for i, row in enumerate(W):
    for j, w in row:
        COLUMNS[j].append((i, w))`,
    String.raw`class Fault(Exception):
    """A checked error: the machine stops instead of wrapping or clamping."""

    def __init__(self, message, ticks):
        super().__init__(message)
        self.ticks = ticks`,
    String.raw`def multiply(x):
    """Exact signed sums z = W x."""
    z = [0] * len(x)
    for j in compress(range(len(x)), x):  # every j with x[j] != 0
        for i, w in COLUMNS[j]:
            z[i] += w * x[j]
    return z`,
    String.raw`def relu(z):
    return [v if v > 0 else 0 for v in z]`,
    ...(output || input ? [String.raw`def is_scalar(n):
    return n <= 0x10FFFF and not 0xD800 <= n <= 0xDFFF`] : []),
    [String.raw`def check(x, ticks):
    """Refuse to commit a state with an out-of-bound coordinate or a raised fault gate."""
    if any(map(gt, x, BOUNDS)):
        i = next(i for i, v in enumerate(x) if v > BOUNDS[i])
        raise Fault(f'Register {NAMES[i]} exceeds its {BOUNDS[i]} bound ({x[i]})', ticks)
    for coordinate, message in FAULTS:
        if x[coordinate]:
            raise Fault(message, ticks)`, ...indent(checks.join('\n').split('\n'), 4)].join('\n').trimEnd(),
    String.raw`def initial_state(inputs):
    """x_0 with main's parameters written into their coordinates."""
    x = list(INITIAL)
    for name, value in inputs.items():
        if name not in INPUTS:
            raise ValueError(f'Unknown input: {name}')
        i = INPUTS[name]
        if not isinstance(value, int) or not 0 <= value <= BOUNDS[i]:
            raise ValueError(f'Input {name} must be an integer from 0 to {BOUNDS[i]}')
        x[i] = value
    return x`,
  ].join('\n\n\n');

  const step = [
    'z = multiply(x)  # 1. exact signed sums W x',
    ...(input ? String.raw`if x[IN_REQUEST]:
    # The input latch rows of W are zero: the host writes the next character, or
    # end of file, into them. Nothing else crosses into the matrix.${output ? '\n    stdout.flush()' : ''}
    char = '' if closed else stdin.read(1)
    closed = not char
    codepoint = ord(char) if char else 0
    if not is_scalar(codepoint):
        raise Fault('Console input must contain valid Unicode scalar values', ticks)
    z[IN_AVAILABLE], z[IN_EOF], z[IN_CODEPOINT] = 1, int(closed), codepoint`.split('\n') : []),
    'x_next = relu(z)  # 2. ReLU',
    'check(x_next, ticks)  # 3. checked commit',
    'x = x_next',
    'ticks += 1',
    ...(output ? ['if x[OUT_EMIT]:', '    stdout.write(chr(x[OUT_CODEPOINT]))', '    line_open = x[OUT_CODEPOINT] != 10'] : []),
    ...(screen ? ['if x[PX_EMIT]:', '    screen[x[PX_Y]][x[PX_X]] = (x[PX_R], x[PX_G], x[PX_B])'] : []),
  ];
  const loop = ['while not x[END]:', ...indent(step, 4)];
  const streams = [input && 'stdin=None', output && 'stdout=None'].filter(Boolean);
  const returns = screen ? 'x, ticks, screen' : 'x, ticks';
  const run = [
    `def run(x${streams.map(stream => `, ${stream}`).join('')}):`,
    output || input
      ? `    """Repeat x <- ReLU(W x) from state x until x[END] != 0; return (${returns}).\n${output ? '\n    Console output is written to stdout as it is emitted.' : ''}${input ? '\n    Console input is read from stdin one character at a time, only when the\n    program requests it.' : ''}\n    """`
      : `    """Repeat x <- ReLU(W x) from state x until x[END] != 0; return (${returns})."""`,
    ...(input ? ['    stdin = stdin or sys.stdin', '    closed = False  # stdin reached end of file'] : []),
    ...(output ? ['    stdout = stdout or sys.stdout', '    line_open = False  # the last console line has no newline yet'] : []),
    ...(screen ? ['    screen = [[(0, 0, 0)] * 16 for _ in range(16)]'] : []),
    '    ticks = 0',
    ...(output ? ['    try:', ...indent(loop, 8), '    finally:', '        if line_open:', "            stdout.write('\\n')", '        stdout.flush()'] : indent(loop, 4)),
    `    return ${returns}`,
  ].join('\n');

  const show = screen ? `\n\n\n${String.raw`def show(screen):
    """Draw the display: true color in a terminal, '#' per lit pixel otherwise."""
    for row in screen:
        if sys.stdout.isatty():
            print(''.join(f'\x1b[48;2;{r};{g};{b}m  ' for r, g, b in row) + '\x1b[0m')
        else:
            print(''.join('#' if any(pixel) else '.' for pixel in row))`}` : '';
  const main = String.raw`def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    for index, (name, default) in enumerate(DEFAULTS.items()):
        parser.add_argument(f'input{index}', metavar=name, type=int, nargs='?', default=default,
                            help=f'0 to {BOUNDS[INPUTS[name]]} (default {default})')
    args = vars(parser.parse_args())
    try:
        x = initial_state({name: args[f'input{index}'] for index, name in enumerate(DEFAULTS)})
    except ValueError as error:
        parser.error(str(error))
    try:
        ${returns} = run(x)
    except Fault as fault:
        sys.exit(f'Fault after {fault.ticks} ticks: {fault}')
    except KeyboardInterrupt:
        sys.exit('Interrupted.')${screen ? `
    if any(any(pixel) for row in screen for pixel in row):
        show(screen)` : ''}
    if RESULT is not None:
        print(f'result = {x[RESULT]}')
    sys.stdout.flush()
    print(f'Ended after {ticks} ticks.', file=sys.stderr)


if __name__ == '__main__':
    main()
`;
  return `${header}\n\n${data}\n\n${machine}\n\n\n${run}${show}\n\n\n${main}`;
}
