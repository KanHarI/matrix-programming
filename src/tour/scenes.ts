import type { Artifact } from '../core/types';
import { examples } from '../examples';
import { fibonacciRun, fibonacciSource, helloOutput, parity, parityRun, paritySource, shortName, type ParityRun } from './data';
import { code, el, fill, matrix, num, operator, play, reluArrow, titled, vector, wait } from './render';

/** A stage layer; `enter` starts its timeline for one chapter and stops when `signal` aborts. */
export interface Scene { root: HTMLElement; enter(signal: AbortSignal, beat?: string): void }

export const layer = (name: string) => { const root = el('div', `t-scene t-scene-${name}`); root.dataset.scene = name; return root; };
function dense(artifact: Artifact): number[][] {
  return artifact.rows.map(row => {
    const values = new Array<number>(artifact.rows.length).fill(0);
    row.cols.forEach((column, index) => { values[column]! += row.weights[index]!; });
    return values;
  });
}
const names = (artifact: Artifact) => artifact.registers.map((_, index) => shortName(artifact, index));
const indexOf = (artifact: Artifact, suffix: string) => artifact.registers.findIndex(register => register.name.split('.').pop() === suffix);
/** A row of W as a readable weighted sum, e.g. `remaining − 2·const_1`. */
function formula(artifact: Artifact, row: number): string {
  const { cols, weights } = artifact.rows[row]!;
  if (!cols.length) return '0';
  return cols.map((column, index) => {
    const weight = weights[index]!, magnitude = Math.abs(weight);
    const term = `${magnitude === 1 ? '' : `${magnitude}·`}${shortName(artifact, column)}`;
    return index === 0 ? `${weight < 0 ? '−' : ''}${term}` : `${weight < 0 ? ' − ' : ' + '}${term}`;
  }).join('');
}
function products(artifact: Artifact, row: number, x: number[]): string {
  const { cols, weights } = artifact.rows[row]!;
  if (!cols.length) return '0';
  return cols.map((column, index) => { const weight = weights[index]!; return `${weight < 0 ? `(${num(weight)})` : weight}×${x[column]}`; }).join(' + ');
}
export function highlight(elements: Iterable<Element>, className: string, on: (index: number) => boolean): void {
  [...elements].forEach((element, index) => element.classList.toggle(className, on(index)));
}

export function heroScene(): Scene {
  const root = layer('hero');
  const run = parityRun(4);
  const equation = el('div', 't-equation');
  equation.innerHTML = '<i>x</i><sub>t+1</sub> <span class="t-eq">=</span> <span class="t-relu">ReLU</span>(<i>W</i><i>x</i><sub>t</sub>)';
  const W = titled(matrix(dense(run.artifact)), 'W');
  const x = titled(vector(run.updates[0]!.x), 'x', 't');
  const next = titled(vector(run.updates[0]!.y), 'x', 't+1');
  const objects = el('div', 't-objects');
  objects.append(W.root, operator('×'), x.root, reluArrow(), next.root);
  const caption = el('p', 't-stage-caption');
  root.append(equation, objects, caption);
  return {
    root,
    enter(signal) {
      play(async () => {
        for (;;) {
          for (const update of run.updates) {
            fill(x, update.x); fill(next, update.y);
            caption.textContent = `Parity of 4 · tick ${update.tick} → ${update.tick + 1}`;
            await wait(1500, signal);
          }
          caption.textContent = 'end = 1 · result = 1 · 4 is even';
          await wait(2200, signal);
        }
      });
    },
  };
}

export function stateScene(): Scene {
  const root = layer('state');
  const artifact = parity();
  const start = parityRun(4).updates[0]!.x;
  const x = titled(vector(start, { labels: names(artifact) }), 'x', 't');
  const roles = el('div', 't-roles');
  const role = (index: number) => Object.values(artifact.inputs).includes(index) ? 'input n'
    : index === artifact.led ? 'result · LED' : index === artifact.end ? 'end gate'
    : artifact.registers[index]!.kind === 'constant' ? 'constant' : 'loop helper';
  const chips = start.map((_, index) => { const chip = el('span', 't-chip', role(index)); roles.append(chip); return chip; });
  x.root.querySelector('.t-vector-body')!.append(roles);
  const note = el('p', 't-stage-caption', 'Each entry: a whole number from 0 to 4,294,967,295');
  root.append(x.root, note);
  return {
    root,
    enter(signal) {
      play(async () => {
        for (const item of [...x.cells, ...x.labels, ...chips]) item.classList.add('t-hidden');
        for (let index = 0; index < start.length; index++) {
          await wait(index ? 420 : 250, signal);
          for (const item of [x.cells[index], x.labels[index], chips[index]]) item!.classList.remove('t-hidden');
        }
      });
    },
  };
}

export function matrixScene(): Scene {
  const root = layer('matrix');
  const artifact = parity();
  const W = titled(matrix(dense(artifact), undefined, names(artifact)), 'W');
  const caption = el('p', 't-formula');
  root.append(W.root, caption);
  return {
    root,
    enter(signal) {
      play(async () => {
        for (let row = 0; ; row = (row + 1) % artifact.rows.length) {
          highlight(W.rows, 't-lit', index => index === row);
          caption.innerHTML = '';
          caption.append(el('strong', '', `${shortName(artifact, row)}`), el('span', '', ' next = ReLU( '), el('code', '', formula(artifact, row)), el('span', '', ' )'));
          await wait(1900, signal);
        }
      });
    },
  };
}

export function multiplyScene(): Scene {
  const root = layer('multiply');
  const artifact = parity();
  const update = parityRun(4).updates[0]!;
  const W = titled(matrix(dense(artifact)), 'W');
  const x = titled(vector(update.x), 'x', 't');
  const z = titled(vector(update.z.map(() => undefined)), 'z');
  const objects = el('div', 't-objects');
  objects.append(W.root, operator('×'), x.root, operator('='), z.root);
  const calculation = el('p', 't-formula');
  root.append(objects, calculation);
  return {
    root,
    enter(signal) {
      play(async () => {
        for (;;) {
          fill(z, update.z.map(() => undefined), false);
          for (let row = 0; row < artifact.rows.length; row++) {
            highlight(W.rows, 't-lit', index => index === row);
            highlight(z.cells, 't-lit', index => index === row);
            const cols = artifact.rows[row]!.cols;
            highlight(x.cells, 't-lit', index => cols.includes(index));
            calculation.innerHTML = '';
            calculation.append(el('strong', '', `z${String(row).replace(/\d/g, digit => '₀₁₂₃₄₅₆₇₈₉'[Number(digit)]!)}`), el('span', '', ' = '), el('code', '', products(artifact, row, update.x)), el('span', '', ' = '), el('strong', update.z[row]! < 0 ? 't-negative' : '', num(update.z[row])));
            await wait(650, signal);
            fill(z, update.z.map((value, index) => index <= row ? value : undefined));
            await wait(900, signal);
          }
          highlight([...W.rows, ...x.cells, ...z.cells], 't-lit', () => false);
          calculation.textContent = 'Signed sums: some are negative.';
          await wait(2200, signal);
        }
      });
    },
  };
}

export function reluScene(): Scene {
  const root = layer('relu');
  const updates = parityRun(4).updates;
  const z = titled(vector(updates[0]!.z), 'z');
  const y = titled(vector(updates[0]!.y), 'x', 't+1');
  const objects = el('div', 't-objects');
  objects.append(z.root, reluArrow(), y.root);
  const caption = el('p', 't-formula');
  caption.innerHTML = '<code>max(0, z)</code>, entry by entry';
  root.append(objects, caption);
  return {
    root,
    enter(signal) {
      play(async () => {
        for (let pass = 0; ; pass++) {
          const update = updates[pass % 2 ? 2 : 0]!;
          fill(z, update.z, false); fill(y, update.y.map(() => undefined), false);
          highlight(y.cells, 't-clamped', () => false);
          await wait(700, signal);
          for (let index = 0; index < update.z.length; index++) {
            highlight(z.cells, 't-lit', item => item === index);
            fill(y, update.y.map((value, item) => item <= index ? value : undefined));
            y.cells[index]!.classList.toggle('t-clamped', update.z[index]! < 0);
            await wait(update.z[index]! < 0 ? 900 : 450, signal);
          }
          highlight(z.cells, 't-lit', () => false);
          await wait(2400, signal);
        }
      });
    },
  };
}

/** Whole updates of the parity machine, repeated until the end gate fires. */
export function loopScene(): Scene & { setInput(n: number): void } {
  const root = layer('loop');
  let run: ParityRun = parityRun(4);
  let restart: (() => void) | undefined;
  const artifact = run.artifact;
  const labels = names(artifact);
  const x = titled(vector(run.updates[0]!.x, { labels }), 'x', 't');
  const blank = labels.map(() => undefined);
  const z = titled(vector(blank), 'z');
  const y = titled(vector(blank), 'x', 't+1');
  const objects = el('div', 't-objects');
  objects.append(x.root, operator('→'), z.root, reluArrow(), y.root);
  const status = el('div', 't-loop-status');
  const tick = el('span', 't-tick');
  const phase = el('span', 't-phase');
  const led = el('span', 't-gate t-led', 'LED');
  const end = el('span', 't-gate t-end', 'END');
  status.append(tick, phase, led, end);
  const verdict = el('p', 't-stage-caption');
  root.append(status, objects, verdict);
  const scene = {
    root,
    enter(signal: AbortSignal) {
      let inner = new AbortController();
      const timeline = (local: AbortSignal) => play(async () => {
        for (;;) {
          const n = run.updates[0]!.x[0]!;
          led.classList.remove('t-on'); end.classList.remove('t-on'); verdict.textContent = `n = ${n}`;
          for (const update of run.updates) {
            fill(x, update.x); fill(z, update.z.map(() => undefined), false); fill(y, update.y.map(() => undefined), false);
            tick.textContent = `tick ${update.tick}`;
            phase.textContent = 'Multiply'; await wait(650, local); fill(z, update.z);
            phase.textContent = 'Apply ReLU'; await wait(650, local); fill(y, update.y);
            phase.textContent = 'Commit'; await wait(650, local);
          }
          fill(x, run.final); fill(z, run.final.map(() => undefined), false); fill(y, run.final.map(() => undefined), false);
          tick.textContent = `tick ${run.updates.length}`; phase.textContent = 'Ended';
          const result = run.final[artifact.led!]!;
          led.classList.toggle('t-on', result !== 0); end.classList.add('t-on');
          verdict.textContent = `n = ${n} is ${result ? 'even' : 'odd'} · ${run.updates.length} ticks`;
          // The chapter's live region is created after the stage, so look it up when announcing.
          const live = document.getElementById('loop-result');
          if (live) live.textContent = `n = ${n}: ${result ? 'even' : 'odd'}, after ${run.updates.length} ticks.`;
          await wait(3200, local);
        }
      });
      restart = () => { inner.abort(); inner = new AbortController(); timeline(inner.signal); };
      signal.addEventListener('abort', () => { inner.abort(); restart = undefined; }, { once: true });
      timeline(inner.signal);
    },
    setInput(n: number) { run = parityRun(n); restart?.(); },
  };
  return scene;
}

export function sourceScene(): Scene {
  const root = layer('source');
  const artifact = parity();
  // Skip the header comments; the listing keeps the source's real line numbers.
  const all = paritySource.split('\n');
  const first = all.findIndex(line => !/^\s*\/\//.test(line));
  const listing = code(all.slice(first).join('\n').trimEnd(), first + 1);
  const lineOf = (pattern: RegExp) => all.findIndex(line => pattern.test(line)) - first;
  const W = matrix(dense(artifact), undefined, names(artifact));
  const body = el('div', 't-source-body');
  body.append(listing.root, operator('⟶'), W.root);
  const caption = el('p', 't-formula');
  root.append(body, caption);
  const remaining = indexOf(artifact, 'remaining'), below1 = indexOf(artifact, 'belowStrideMinusOne'), below2 = indexOf(artifact, 'belowStride');
  const groups: { lines: number[]; rows: number[]; text: string }[] = [
    { lines: [lineOf(/let remaining/)], rows: [remaining], text: 'The input n is written straight into entry remaining.' },
    { lines: [lineOf(/while/), lineOf(/remaining = remaining/)], rows: [remaining, below1, below2], text: 'Row remaining subtracts 2 every tick, and ReLU stops it at 0. below_1 = ReLU(1 − remaining) and below_2 = ReLU(2 − remaining) turn positive as the countdown finishes.' },
    { lines: [lineOf(/return/)], rows: [artifact.result!, artifact.end], text: 'result copies below_1, which is 1 only when the countdown reached 0. end = below_2 − below_1 fires once remaining is 0 or 1.' },
  ];
  return {
    root,
    enter(signal) {
      play(async () => {
        for (let group = 0; ; group = (group + 1) % groups.length) {
          const { lines, rows, text } = groups[group]!;
          highlight(listing.lines, 't-lit', index => lines.includes(index));
          highlight(W.rows, 't-lit', index => rows.includes(index));
          caption.textContent = text;
          await wait(3600, signal);
        }
      });
    },
  };
}

export function gatesScene(): Scene {
  const root = layer('gates');
  const card = (title: string) => { const element = el('div', 't-card'); element.append(el('h3', '', title)); return element; };
  const and = card('AND with one ReLU');
  const andFormula = el('p', 't-gate-formula');
  const table = el('table', 't-truth');
  table.innerHTML = '<thead><tr><th>a</th><th>b</th><th>a + b − 1</th><th>ReLU</th></tr></thead>';
  const body = table.createTBody();
  const combos = [[0, 0], [0, 1], [1, 0], [1, 1]] as const;
  const rows = combos.map(([a, b]) => { const row = body.insertRow(); for (const value of [a, b, a + b - 1, Math.max(0, a + b - 1)]) row.insertCell().textContent = num(value); return row; });
  and.append(andFormula, table);
  const gate = card('Pass a value only when switched on');
  const gateFormula = el('p', 't-gate-formula');
  const gateResult = el('p', 't-gate-result');
  gate.append(gateFormula, gateResult, el('p', 't-footnote', 'Here M = 1,000. The real compiler uses M = 2,147,483,647, the largest allowed weight, and chains stages so large values are gated too.'));
  const cards = el('div', 't-cards');
  cards.append(and, gate);
  root.append(cards);
  return {
    root,
    enter(signal) {
      play(async () => {
        for (let step = 0; ; step++) {
          const [a, b] = combos[step % 4]!;
          highlight(rows, 't-lit', index => index === step % 4);
          andFormula.innerHTML = `ReLU(<b>${a}</b> + <b>${b}</b> − 1) = ReLU(${num(a + b - 1)}) = <strong>${Math.max(0, a + b - 1)}</strong>`;
          const s = step % 2 ? 0 : 1;
          gateFormula.innerHTML = `ReLU(<b>37</b> + 1000·<b>${s}</b> − 1000) = ReLU(${num(37 + 1000 * s - 1000)})`;
          gateResult.innerHTML = `s = ${s} → <strong>${Math.max(0, 37 + 1000 * s - 1000)}</strong>`;
          gateResult.classList.toggle('t-off', !s);
          await wait(1500, signal);
        }
      });
    },
  };
}

export function programCounterScene(): Scene {
  const root = layer('pc');
  const run = fibonacciRun(5);
  const listing = code(fibonacciSource);
  const side = el('div', 't-pc-side');
  const counter = el('div', 't-pc');
  const markers = run.artifact.markers.map(marker => { const cell = el('span', 't-pc-cell', `L${marker.line}`); counter.append(cell); return cell; });
  const clock = el('div', 't-clock');
  const phases = Array.from({ length: 11 }, (_, index) => {
    const dot = el('span', 't-clock-dot');
    dot.style.setProperty('--angle', `${index * 360 / 11}deg`);
    clock.append(dot); return dot;
  });
  const phaseLabel = el('span', 't-clock-label');
  clock.append(phaseLabel);
  const variables = el('dl', 't-variables');
  const values = Object.fromEntries(['n', 'a', 'b', 't'].map(name => { variables.append(el('dt', '', name)); const value = el('dd', '', '0'); variables.append(value); return [name, value]; }));
  const tick = el('p', 't-stage-caption');
  side.append(el('h3', '', 'Program counter'), counter, el('h3', '', 'Clock'), clock, variables);
  const body = el('div', 't-pc-body');
  body.append(listing.root, side);
  root.append(body, tick);
  return {
    root,
    enter(signal) {
      play(async () => {
        for (;;) {
          for (const frame of run.ticks) {
            highlight(listing.lines, 't-lit', index => frame.lines.includes(index + 1));
            highlight(markers, 't-lit', index => index === frame.marker);
            highlight(phases, 't-lit', index => index === frame.phase);
            phaseLabel.textContent = frame.phase < 0 ? '' : String(frame.phase);
            for (const [name, element] of Object.entries(values)) element.textContent = String(frame.values[name] ?? 0);
            tick.textContent = `F(5) · tick ${frame.tick}`;
            await wait(70, signal);
          }
          tick.textContent = `F(5) = ${run.result} after ${run.ticks.length - 1} ticks`;
          await wait(2600, signal);
        }
      });
    },
  };
}

/** A schematic of the lab, not a screenshot: each chapter walks one part of it. */
export interface AppFrame {
  app: HTMLElement; content: HTMLElement; cursor: HTMLElement;
  selectTab(name: string): void;
  /** Move the pointer to an element and, by default, press it. */
  point(target: Element, signal: AbortSignal, click?: boolean): Promise<void>;
  /** Park the pointer before a beat starts. */
  reset(): void;
}
/** A schematic of the lab's window, tabs and pointer, shared by the lab scenes. */
export function appFrame(root: HTMLElement): AppFrame {
  const app = el('div', 't-app');
  const bar = el('div', 't-app-bar'); bar.append(el('span', 't-app-dots'), el('span', '', 'Matrix Lab'));
  const tabs = el('div', 't-app-tabs');
  const tabButtons = Object.fromEntries(['Presets', 'Program', 'Run', 'Inspect'].map(name => { const tab = el('span', 't-app-tab', name); tabs.append(tab); return [name, tab]; }));
  const content = el('div', 't-app-content');
  const cursor = el('span', 't-cursor');
  cursor.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 1l11 6.5-4.6 1.2L11 14l-2.2 1-2.5-5.3L2.8 13z"/></svg>';
  app.append(bar, tabs, content, cursor);
  root.append(app);
  return {
    app, content, cursor,
    selectTab(name) { for (const [tab, element] of Object.entries(tabButtons)) element.classList.toggle('t-selected', tab === name); },
    async point(target, signal, click = true) {
      const box = target.getBoundingClientRect(), frame = app.getBoundingClientRect();
      cursor.style.transform = `translate(${box.left - frame.left + box.width * .6}px, ${box.top - frame.top + box.height * .55}px)`;
      await wait(750, signal);
      if (!click) return;
      target.classList.remove('t-pressed'); void (target as HTMLElement).offsetWidth; target.classList.add('t-pressed');
      await wait(350, signal);
    },
    reset() {
      cursor.classList.remove('t-hidden');
      cursor.style.transform = `translate(${app.clientWidth * .55}px, ${app.clientHeight * .75}px)`;
    },
  };
}

export function labScene(): Scene {
  const root = layer('lab');
  const { content, cursor, selectTab, point, reset } = appFrame(root);
  const run = parityRun(4);
  const artifact = run.artifact;
  const beats: Record<string, (signal: AbortSignal) => Promise<void>> = {
    async presets(signal) {
      selectTab('Presets');
      const grid = el('div', 't-app-cards');
      const cards = examples.slice(0, 6).map(example => { const card = el('div', 't-app-card'); card.append(el('strong', '', example.name.split(' · ')[0]!), el('span', '', example.description.split('. ')[0]!)); grid.append(card); return card; });
      content.replaceChildren(grid);
      for (;;) {
        highlight(cards, 't-selected', () => false); selectTab('Presets');
        await wait(500, signal);
        await point(cards[0]!, signal);
        cards[0]!.classList.add('t-selected'); await wait(450, signal);
        selectTab('Program'); await wait(1800, signal);
      }
    },
    async program(signal) {
      selectTab('Program');
      const listing = code(paritySource.split('\n').slice(3).join('\n'));
      const footer = el('div', 't-app-footer');
      const status = el('span', '', 'Compiled · fixed sparse matrix');
      const compile = el('span', 't-app-button t-primary', 'Compile & reset ↗');
      footer.append(status, compile);
      content.replaceChildren(listing.root, footer);
      for (;;) {
        selectTab('Program'); status.textContent = 'Source changed · compile to apply';
        await wait(700, signal);
        await point(compile, signal);
        status.textContent = 'Compiled · fixed sparse matrix'; await wait(400, signal);
        selectTab('Run'); await wait(1900, signal);
      }
    },
    async run(signal) {
      selectTab('Run');
      const toolbar = el('div', 't-app-toolbar');
      const primary = el('span', 't-app-button t-primary');
      const buttons = [primary, ...['Full tick', 'Step line', '▶ Run', '↺'].map(label => el('span', 't-app-button', label))];
      const keys = ['.', 'T', 'L', 'R', ''];
      buttons.forEach((button, index) => { if (keys[index]) button.dataset.key = keys[index]; toolbar.append(button); });
      const tickLabel = el('span', 't-app-tick');
      toolbar.append(tickLabel);
      const x = titled(vector(run.updates[0]!.x), 'x', 't'), z = titled(vector(run.updates[0]!.z), 'z'), y = titled(vector(run.updates[0]!.y), 'x', 't+1');
      const objects = el('div', 't-objects t-small');
      objects.append(x.root, operator('→'), z.root, reluArrow(), y.root);
      content.replaceChildren(toolbar, objects);
      for (;;) {
        for (const update of run.updates.slice(0, 3)) {
          fill(x, update.x, false); fill(z, update.z.map(() => undefined), false); fill(y, update.y.map(() => undefined), false);
          tickLabel.textContent = `tick ${update.tick}`;
          primary.textContent = 'Multiply →'; await point(primary, signal); fill(z, update.z);
          primary.textContent = 'Apply ReLU →'; await point(primary, signal); fill(y, update.y);
          primary.textContent = 'Commit tick →'; await point(primary, signal);
          await wait(300, signal);
        }
        await point(buttons[2]!, signal, false);
        await wait(1200, signal);
      }
    },
    async devices(signal) {
      selectTab('Run');
      cursor.classList.add('t-hidden');
      const events = helloOutput();
      const devices = el('div', 't-app-devices');
      const terminal = el('pre', 't-app-console');
      const screen = el('div', 't-app-screen');
      const pixels = Array.from({ length: 256 }, () => { const pixel = el('span'); screen.append(pixel); return pixel; });
      devices.append(terminal, screen);
      content.replaceChildren(devices);
      const last = events.at(-1)?.tick ?? 1;
      for (;;) {
        terminal.textContent = ''; for (const pixel of pixels) pixel.style.background = '';
        await wait(600, signal);
        let previous = 0;
        for (const event of events) {
          await wait((event.tick - previous) / last * 4200, signal);
          previous = event.tick;
          if (event.kind === 'char') terminal.textContent += event.text;
          else pixels[event.y * 16 + event.x]!.style.background = event.color;
        }
        await wait(2600, signal);
      }
    },
  };
  return {
    root,
    enter(signal, beat = 'presets') {
      reset();
      play(() => beats[beat]!(signal));
    },
  };
}

export function outroScene(): Scene {
  const root = layer('outro');
  const equation = el('div', 't-equation');
  equation.innerHTML = '<i>x</i><sub>t+1</sub> <span class="t-eq">=</span> <span class="t-relu">ReLU</span>(<i>W</i><i>x</i><sub>t</sub>)';
  const screen = el('div', 't-app-screen t-outro-screen');
  const pixels = Array.from({ length: 256 }, () => { const pixel = el('span'); screen.append(pixel); return pixel; });
  root.append(equation, screen, el('p', 't-stage-caption', 'All computation stays in your browser.'));
  return {
    root,
    enter(signal) {
      play(async () => {
        for (const pixel of pixels) pixel.style.background = '';
        for (const event of helloOutput()) {
          if (event.kind !== 'pixel') continue;
          pixels[event.y * 16 + event.x]!.style.background = event.color;
          await wait(90, signal);
        }
      });
    },
  };
}
