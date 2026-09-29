import { clockTrace, type ClockTrace } from './data';
import { el, fill, matrix, num, operator, play, titled, vector, wait } from './render';
import { highlight, layer, type Scene } from './scenes';

const subscript = (value: number | string) => String(value).replace(/\d/g, digit => '₀₁₂₃₄₅₆₇₈₉'[Number(digit)]!);
let shared: ClockTrace | undefined;
const trace = () => shared ??= clockTrace();

/** Readable names for the circuit coordinates of `let t = a + b;`. */
function circuitLabel(data: ClockTrace, index: number, name: string): string {
  const target = data.artifact.markers.find(marker => marker.register === data.pc)!.label.split('.').pop()!;
  if (index === data.pc) return `pc · line ${data.line}`;
  if (index === data.nextPc) return `pc · line ${data.line + 1}`;
  const layerNames: Record<string, string> = { high1: 'layer 1', selected: 'layer 1', high2: 'layer 2', 'value.1': 'layer 2', value: 'layer 3', 'value.2': 'layer 3' };
  let match = /\.read\.([abc])\.\d+$/.exec(name);
  if (match) return `select ${match[1]}`;
  if ((match = /\.read\.([abc])\.\d+\.select(2?)\.1$/.exec(name))) return `select ${match[1]}${match[2] ? '″' : '′'}`;
  if ((match = /\.read\.([abc])\.\d+\.(high1|high2|selected|value(?:\.\d)?)$/.exec(name))) return `gate ${match[1]} · ${layerNames[match[2]!]}`;
  if ((match = /\.operand\.([abc])$/.exec(name))) return `operand ${match[1]}`;
  if (/\.alu$/.test(name)) return 'ALU';
  if (/\.write\.\d+\.select$/.test(name)) return `write ${target} select`;
  if ((match = /\.write\.\d+\.old\.select(2?)\.1$/.exec(name))) return `write ${target} select${match[1] ? '″' : '′'}`;
  if ((match = /\.write\.\d+\.(old|new)\.(high1|high2|selected|value(?:\.\d)?)$/.exec(name))) return `${match[1]} ${target} · ${layerNames[match[2]!]}`;
  if (/dispatch$/.test(name)) return 'dispatch';
  return name;
}

/** A row of W as a formula, naming the coordinates this deep dive discusses. */
function rowFormula(data: ClockTrace, row: number): string {
  const label = (index: number) => {
    const name = data.artifact.registers[index]!.name;
    if (index === data.pc) return `pc${subscript(data.line)}`;
    if (index === data.nextPc) return `pc${subscript(data.line + 1)}`;
    if (index === data.dispatch) return 'dispatch';
    const phase = data.clock.indexOf(index);
    if (phase >= 0) return `clock${subscript(phase)}`;
    if (name === 'constant.1') return '1';
    if (/branch\.\d+\.(on|off)$/.test(name)) return 'loop test';
    if (/dispatch$/.test(name)) return `its dispatch`;
    return name;
  };
  const { cols, weights } = data.artifact.rows[row]!;
  const terms = cols.map((column, index) => ({ column, weight: weights[index]! })).sort((x, y) => Number(y.weight > 0) - Number(x.weight > 0));
  return terms.map(({ column, weight }, index) => {
    const magnitude = Math.abs(weight), name = label(column);
    const term = name === '1' ? String(magnitude) : `${magnitude === 1 ? '' : `${magnitude}·`}${name}`;
    return index === 0 ? `${weight < 0 ? '−' : ''}${term}` : `${weight < 0 ? ' − ' : ' + '}${term}`;
  }).join('');
}

export function clockRingScene(): Scene {
  const root = layer('ring');
  const data = trace();
  const labels = data.clock.map((_, phase) => `clock ${phase}`);
  const W = titled(matrix(data.ring, undefined, labels), 'W');
  const x = titled(vector(data.clock.map(() => 0)), 'x', 't');
  const next = titled(vector(data.clock.map(() => 0)), 'x', 't+1');
  const objects = el('div', 't-objects t-dense');
  objects.append(W.root, operator('×'), x.root, operator('='), next.root);
  const ring = el('div', 't-clock t-clock-large');
  const dots = data.clock.map((_, phase) => {
    const dot = el('span', 't-clock-dot'); dot.style.setProperty('--angle', `${phase * 360 / 11}deg`); ring.append(dot); return dot;
  });
  const center = el('span', 't-clock-label'); ring.append(center);
  const body = el('div', 't-ring-body');
  body.append(objects, ring);
  const caption = el('p', 't-formula');
  root.append(body, caption, el('p', 't-stage-caption', 'The 11 × 11 clock block of W, exactly as compiled for Fibonacci'));
  return {
    root,
    enter(signal) {
      play(async () => {
        for (let phase = 0; ; phase = (phase + 1) % 11) {
          const after = (phase + 1) % 11;
          fill(x, data.clock.map((_, index) => Number(index === phase)), false);
          fill(next, data.clock.map(() => undefined), false);
          W.cells.forEach((row, r) => row.forEach((cell, c) => cell.classList.toggle('t-lit', r === after && c === phase)));
          highlight(W.rows, 't-lit', index => index === after);
          highlight(x.cells, 't-lit', index => index === phase);
          highlight(dots, 't-lit', index => index === phase);
          center.textContent = String(phase);
          caption.innerHTML = '';
          caption.append(el('code', '', `clock${subscript(after)} next = clock${subscript(phase)}`), el('span', '', `: the 1 moves from phase ${phase} to phase ${after}`));
          await wait(700, signal);
          fill(next, data.clock.map((_, index) => Number(index === after)), false);
          highlight(next.cells, 't-lit', index => index === after);
          await wait(650, signal);
        }
      });
    },
  };
}

export function clockListenScene(): Scene {
  const root = layer('listen');
  const data = trace();
  const lanes: { label: string; key: 'phase' | 'clock9' | 'pc' | 'dispatch' | 'next'; className: string }[] = [
    { label: 'phase', key: 'phase', className: 't-lane-phase' },
    { label: 'clock 9', key: 'clock9', className: 't-lane-clock' },
    { label: `pc · line ${data.line}`, key: 'pc', className: 't-lane-pc' },
    { label: 'dispatch', key: 'dispatch', className: 't-lane-dispatch' },
    { label: `pc · line ${data.line + 1}`, key: 'next', className: 't-lane-next' },
  ];
  const wave = el('div', 't-wave');
  wave.style.gridTemplateColumns = `auto repeat(${data.wave.length}, 1fr)`;
  const columns: HTMLElement[][] = data.wave.map(() => []);
  for (const lane of lanes) {
    wave.append(el('span', 't-wave-label', lane.label));
    data.wave.forEach((sample, index) => {
      const value = sample[lane.key];
      const cell = el('span', `t-wave-cell ${lane.className}${lane.key !== 'phase' && value ? ' t-high' : ''}`, lane.key === 'phase' ? String(value) : '');
      wave.append(cell); columns[index]!.push(cell);
    });
  }
  const code = el('p', 't-wave-code');
  code.append(el('span', '', `line ${data.line}: `), el('code', '', data.text));
  const formulas = el('div', 't-formulas');
  formulas.append(
    el('code', '', `dispatch = ReLU( ${rowFormula(data, data.dispatch)} )`),
    el('code', '', `pc${subscript(data.line)} next = ReLU( ${rowFormula(data, data.pc)} )`),
    el('code', '', `pc${subscript(data.line + 1)} next = ReLU( ${rowFormula(data, data.nextPc)} )`),
  );
  root.append(code, wave, formulas);
  return {
    root,
    enter(signal) {
      play(async () => {
        for (;;) {
          for (let tick = 0; tick < data.wave.length; tick++) {
            columns.forEach((cells, index) => cells.forEach(cell => cell.classList.toggle('t-cursor-column', index === tick)));
            await wait(data.wave[tick]!.dispatch || data.wave[tick]!.clock9 ? 900 : 260, signal);
          }
          await wait(1400, signal);
        }
      });
    },
  };
}

const phaseStages = ['pc on', 'sample clock₁', 'select a, b', 'gate · 1', 'gate · 2', 'gate · 3', 'Σ operands', 'ALU', 'write gate · 1', 'write gate · 2', 'write gate · 3', 'commit'];
const phaseStories = [
  'The program counter for this line turns on. The previous line’s result has just been written.',
  'Read selectors compute ReLU(pc + clock₁ − 1): they sample the clock.',
  'The selectors fire. This instruction reads a and b.',
  'Gate layer 1: ReLU(v + H·s − H) keeps each selected value.',
  'Gate layer 2: ReLU(g + H·s′ − H), with the selector delayed by one tick.',
  'Gate layer 3: ReLU(g + s″ − 1) releases the selected values.',
  'Operand registers add up the selected reads.',
  'The ALU computes a + b − c. The write selector for t fires; it sampled clock₆.',
  'Write gates, layer 1: the new value from the ALU, and the old value of t.',
  'Write gates, layer 2. Control rows sample clock₉.',
  'Write gates, layer 3, release both values. The dispatch pulse fires.',
  'Commit: t = t − old + new, all in one update. Dispatch hands the program counter to the next line.',
];
export function clockPhasesScene(): Scene {
  const root = layer('phases');
  const data = trace();
  const header = el('div', 't-phases-header');
  const values = el('span', 't-phases-values');
  header.append(el('code', 't-phases-code', data.text), values);
  const ruler = el('div', 't-phases');
  const cells = data.period.map((_, index) => {
    const cell = el('div', 't-phase-cell');
    cell.append(el('b', '', index === 11 ? '0′' : String(index)), el('small', '', phaseStages[index]!));
    ruler.append(cell); return cell;
  });
  const story = el('p', 't-formula t-phase-story');
  const live = el('div', 't-live-coordinates');
  root.append(header, ruler, story, live);
  return {
    root,
    enter(signal) {
      play(async () => {
        for (;;) {
          for (const [index, phase] of data.period.entries()) {
            highlight(cells, 't-lit', item => item === index);
            highlight(cells, 't-past', item => item < index);
            const { a, b, t } = phase.values;
            values.textContent = `a = ${a}   b = ${b}   t = ${t}`;
            story.innerHTML = '';
            story.append(el('strong', '', `Phase ${index === 11 ? '0 again' : index} · tick ${phase.tick}. `), el('span', '', phaseStories[index]!));
            live.replaceChildren(el('span', 't-live-title', 'Nonzero circuit entries'), ...phase.live.map(entry => el('span', 't-chip', `${circuitLabel(data, entry.index, entry.name)} = ${num(entry.value)}`)));
            await wait(index === 11 ? 3200 : 1650, signal);
          }
        }
      });
    },
  };
}

export function clockGateScene(): Scene {
  const root = layer('gate');
  const H = BigInt(trace().gateWeight);
  const v = 2n * H + 1n;
  const relu = (value: bigint) => value < 0n ? 0n : value;
  const format = (value: bigint) => value.toLocaleString('en-US');
  const column = (s: bigint) => {
    const g1 = relu(v + H * s - H), g2 = relu(g1 + H * s - H), out = relu(g2 + s - 1n);
    const card = el('div', `t-card t-gate-card${s ? '' : ' t-gate-off'}`);
    card.append(el('h3', '', `Selector s = ${s}`));
    const rows = [
      [`v`, format(v)],
      [`layer 1 · ReLU(v + H·s − H)`, format(g1)],
      [`layer 2 · ReLU(g₁ + H·s′ − H)`, format(g2)],
      [`layer 3 · ReLU(g₂ + s″ − 1)`, format(out)],
    ].map(([label, value]) => { const row = el('div', 't-gate-row'); row.append(el('span', '', label!), el('strong', '', value!)); card.append(row); return row; });
    return { card, rows };
  };
  const on = column(1n), off = column(0n);
  const cards = el('div', 't-cards');
  cards.append(on.card, off.card);
  root.append(cards, el('p', 't-formula', `H = ${format(H)}, the largest weight in W. Three layers subtract H + H + 1 = ${format(v)}.`));
  return {
    root,
    enter(signal) {
      play(async () => {
        for (;;) {
          for (const rows of [on.rows, off.rows]) rows.forEach((row, index) => row.classList.toggle('t-hidden', index > 0));
          await wait(900, signal);
          for (let index = 1; index < 4; index++) {
            for (const rows of [on.rows, off.rows]) rows[index]!.classList.remove('t-hidden');
            await wait(1300, signal);
          }
          await wait(3000, signal);
        }
      });
    },
  };
}

export function clockWhyScene(): Scene {
  const root = layer('why');
  const groups: [string, number][] = [['pc on', 1], ['select', 1], ['read gate', 3], ['sum', 1], ['ALU', 1], ['write gate', 3], ['commit', 1]];
  const bar = el('div', 't-why-bar');
  const units: HTMLElement[] = [];
  for (const [label, count] of groups) {
    const group = el('div', 't-why-group');
    group.style.flexGrow = String(count);
    const cells = el('div', 't-why-cells');
    for (let index = 0; index < count; index++) { const unit = el('span', 't-why-unit'); cells.append(unit); units.push(unit); }
    group.append(cells, el('span', 't-why-label', `${label} · ${count}`));
    bar.append(group);
  }
  const total = el('p', 't-why-total');
  root.append(bar, total, el('p', 't-stage-caption', 'One tick per ReLU layer · every instruction hands off as the clock wraps to 0'));
  return {
    root,
    enter(signal) {
      play(async () => {
        for (;;) {
          highlight(units, 't-lit', () => false); total.textContent = '';
          for (let index = 0; index < units.length; index++) {
            units[index]!.classList.add('t-lit');
            total.textContent = `${index + 1} update${index ? 's' : ''}`;
            await wait(420, signal);
          }
          total.textContent = '= 11 updates per instruction';
          await wait(3200, signal);
        }
      });
    },
  };
}
