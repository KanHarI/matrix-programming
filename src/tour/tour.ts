import './tour.css';
import { inspectScene } from './inspect-scenes';
import { clockGateScene, clockListenScene, clockPhasesScene, clockRingScene, clockWhyScene } from './clock-scenes';
import { el } from './render';
import { gatesScene, heroScene, labScene, loopScene, matrixScene, multiplyScene, outroScene, programCounterScene, reluScene, sourceScene, stateScene, type Scene } from './scenes';

interface Chapter { id: string; scene: string; beat?: string; eyebrow: string; title: string; body: string; seconds: number }

// Each chapter pairs prose with a stage scene. The prose stands alone; the stage illustrates it.
const mainTour: Chapter[] = [
  { id: 'intro', scene: 'hero', eyebrow: 'Matrix Lab · a guided tour', title: 'What if a program were a matrix?', seconds: 9,
    body: '<p>Matrix Lab compiles small programs into one fixed matrix, <b>W</b>. Running a program means repeating a single step: multiply the state by W, then replace every negative number with zero.</p><p>This tour shows how that works, then how to watch it happen in the lab. Scroll at your own pace, or press <b>Play</b>.</p>' },
  { id: 'state', scene: 'state', eyebrow: 'Chapter 1 · the machine', title: 'The whole machine is one list of numbers', seconds: 9,
    body: '<p>Everything a running program knows lives in a <b>state vector x</b>: variables, temporary results, control flags, and even constants. Each entry is a whole number from 0 to 4,294,967,295.</p><p>This parity checker needs just six entries. Its input, <code>n = 4</code>, starts in the first one.</p>' },
  { id: 'matrix', scene: 'matrix', eyebrow: 'Chapter 1 · the machine', title: 'The program is the matrix W', seconds: 12,
    body: '<p>Row <i>i</i> of W says how to compute the next value of entry <i>i</i>: a weighted sum of the current entries.</p><p>W never changes while the program runs. The same six rows, applied again and again, <em>are</em> the parity program.</p>' },
  { id: 'multiply', scene: 'multiply', eyebrow: 'Chapter 2 · one update', title: 'Step 1 · Multiply', seconds: 12,
    body: '<p>Every row is combined with the same current state: <code>z = W x</code>. No row sees another row’s new value, so the whole vector updates at once.</p><p>The sums are exact and signed. Some come out negative.</p>' },
  { id: 'relu', scene: 'relu', eyebrow: 'Chapter 2 · one update', title: 'Step 2 · Apply ReLU', seconds: 10,
    body: '<p>ReLU keeps positive numbers and turns negative ones into zero: <code>max(0, z)</code>.</p><p>It is the only non-linear part of the machine, and it is what lets a matrix make decisions.</p>' },
  { id: 'commit', scene: 'loop', eyebrow: 'Chapter 2 · one update', title: 'Step 3 · Commit, then repeat', seconds: 14,
    body: '<p>The clipped vector becomes the next state and the tick counter advances. The machine repeats until its <b>end</b> entry turns nonzero.</p><p>The <b>result</b> entry drives an LED: 1 means even. Try another input:</p><p class="t-inputs" role="group" aria-label="Parity input"><button type="button" data-n="3">n = 3</button><button type="button" data-n="4" aria-pressed="true">n = 4</button><button type="button" data-n="7">n = 7</button><button type="button" data-n="10">n = 10</button></p><p id="loop-result" class="t-live" aria-live="polite"></p>' },
  { id: 'source', scene: 'source', eyebrow: 'Chapter 3 · compiling', title: 'Where W comes from', seconds: 12,
    body: '<p>You never write W by hand. You write ordinary code, and the compiler turns it into the matrix.</p><p>This countdown loop is recognized and fused into six entries: one for <code>remaining</code>, two comparison helpers, the result, the end gate, and the constant 1.</p>' },
  { id: 'gates', scene: 'gates', eyebrow: 'Chapter 3 · compiling', title: 'How a matrix makes decisions', seconds: 12,
    body: '<p>Weighted sums plus ReLU are enough for logic. <code>AND(a, b)</code> is <code>ReLU(a + b − 1)</code>.</p><p>To pass a value <i>v</i> only while a switch <i>s</i> is on, compute <code>ReLU(v + M·s − M)</code> with a large M. Comparisons, branches and memory writes are all built from gates like these.</p>' },
  { id: 'control', scene: 'pc', eyebrow: 'Chapter 3 · compiling', title: 'Control flow is a single moving 1', seconds: 18,
    body: '<p>Programs with loops and branches get a <b>program counter</b>: one entry per instruction, exactly one of them 1 at a time.</p><p>An 11-phase clock sequences each instruction (read operands, compute, write back, move on), so each instruction takes 11 ticks. Here is Fibonacci computing F(5).</p><p class="t-side"><a class="t-side-link" href="./tour.html?tour=clock"><span>Side tour</span>How the 11-phase clock works <span aria-hidden="true">→</span></a></p>' },
  { id: 'lab-presets', scene: 'lab', beat: 'presets', eyebrow: 'Using the lab · 1', title: 'Pick a program', seconds: 8,
    body: '<p>The lab opens on the <b>Presets</b> gallery: parity, three primality tests, Hello world with pixels, an interactive greeting, parallel countdowns, recursive factorial, and a matrix computer that simulates the parity matrix.</p><p>Choosing one compiles it and opens its source.</p>' },
  { id: 'lab-program', scene: 'lab', beat: 'program', eyebrow: 'Using the lab · 2', title: 'Read or edit the source', seconds: 8,
    body: '<p>The <b>Program</b> tab holds the editor. Change anything, then press <b>Compile &amp; reset</b> (or Ctrl/⌘ + Enter) to rebuild W and open Run, paused at tick 0.</p><p>If the code has a mistake, the error names the line to fix.</p>' },
  { id: 'lab-run', scene: 'lab', beat: 'run', eyebrow: 'Using the lab · 3', title: 'Run it, one phase at a time', seconds: 14,
    body: '<p><b>Multiply</b>, <b>Apply ReLU</b> and <b>Commit tick</b> walk through one update, exactly as in this tour. <b>Full tick</b> does all three; <b>Step line</b> runs to the next source line; <b>Run</b> plays to the end.</p><p class="t-keys">Keyboard: <kbd>.</kbd> phase, <kbd>T</kbd> tick, <kbd>L</kbd> line, <kbd>R</kbd> run or pause.</p>' },
  { id: 'inspect-layout', scene: 'inspect', beat: 'layout', eyebrow: 'Using the lab · 4 · Inspect, 1 of 6', title: 'Inspect: the whole machine on one page', seconds: 10,
    body: '<p>The <b>Inspect</b> tab gathers the details. On the left are Matrix W and the state vector; on the right, the row calculation, the compiled instructions and the source.</p><p>The execution toolbar stays pinned at the top, so you can step while reading any of it. Run and Inspect share one execution: switching tabs never resets or pauses it.</p>' },
  { id: 'inspect-matrix', scene: 'inspect', beat: 'matrix', eyebrow: 'Using the lab · 4 · Inspect, 2 of 6', title: 'Read W row by row', seconds: 14,
    body: '<p><b>Logical rows</b> lists each row of W as a dictionary: the entries it reads and their exact weights. With <b>Diagonal default on (1)</b>, self-weights of 1 are left out, so a row that only keeps its value reads <code>{ }</code>.</p><p>Turn the default off to list every nonzero weight, or switch to the <b>Coefficient grid</b> to see every weight, zeros included. Show 12, 48 or 192 rows per page, search by name or index, and download the full matrix as JSON or CSV.</p>' },
  { id: 'inspect-vector', scene: 'inspect', beat: 'vector', eyebrow: 'Using the lab · 4 · Inspect, 3 of 6', title: 'The state vector, three values per entry', seconds: 14,
    body: '<p>The table shows each entry’s current value x<sub>t</sub>, its signed sum before ReLU, and its value after ReLU. Negative sums are marked, and so are values that ReLU clamped to zero.</p><p>Filter by name, show only entries that changed, or reveal the compiler’s internal circuitry. It is hidden by default in large programs, but a search always finds it.</p>' },
  { id: 'inspect-row', scene: 'inspect', beat: 'row', eyebrow: 'Using the lab · 4 · Inspect, 4 of 6', title: 'Follow one calculation', seconds: 10,
    body: '<p>Click any entry, in the table, in W, or on the Run tab, to open its <b>row calculation</b>: every weighted term with its current value, the exact sum, and ReLU.</p><p>Chips show where the entry comes from: its kind, its context and its source line. Click a term to follow the data one step back.</p>' },
  { id: 'inspect-instructions', scene: 'inspect', beat: 'instructions', eyebrow: 'Using the lab · 4 · Inspect, 5 of 6', title: 'Lines, program counters and breakpoints', seconds: 12,
    body: '<p><b>Compiled instructions</b> maps each source line to the program-counter entries it compiled into, and highlights the line that is running.</p><p>Click a line’s dot, click a line number in the editor, or press F9 to set a breakpoint. <b>Run</b> and <b>Step line</b> pause when that line starts, and the toolbar says why.</p>' },
  { id: 'inspect-history', scene: 'inspect', beat: 'history', eyebrow: 'Using the lab · 4 · Inspect, 6 of 6', title: 'What changed, and what went wrong', seconds: 12,
    body: '<p><b>Recent snapshots</b> list what each commit changed, old value → new value.</p><p>If a value overflows, the machine stops instead of wrapping. The message gives the exact value and the line that was running, and one click opens the row that overflowed. This fault is real: a loop that adds 2 to 4,294,967,295.</p>' },
  { id: 'lab-devices', scene: 'lab', beat: 'devices', eyebrow: 'Using the lab · 5', title: 'Watch the outputs', seconds: 10,
    body: '<p>Programs can print to a console, read typed input, and draw on a 16 × 16 screen through six entries: x, y, red, green, blue and emit.</p><p>Output happens only when an update commits, never during a preview. This is the Hello preset, running for real.</p>' },
  { id: 'outro', scene: 'outro', eyebrow: 'Your turn', title: 'Open the lab', seconds: 8,
    body: '<p>Start with parity, try the primality presets, then break something on purpose and step through the fault.</p><p class="t-cta"><a class="t-button t-primary" href="./">Open the lab</a><a class="t-button" href="./?preset=parity">Start with parity</a><button class="t-button" type="button" data-replay>Replay the tour</button></p>' },
];

// A side tour: optional depth, reached from the main tour's control-flow chapter.
const clockTour: Chapter[] = [
  { id: 'clock-intro', scene: 'pc', eyebrow: 'Side tour', title: 'The 11-phase clock', seconds: 12,
    body: '<p>In the main tour, programs with loops got a program counter, and every instruction took 11 ticks of a shared clock.</p><p>This side tour takes that clock apart: what it is made of, how instructions use it, and why it has eleven phases. It uses the same Fibonacci program, computed live.</p>' },
  { id: 'clock-ring', scene: 'ring', eyebrow: 'Side tour · the 11-phase clock · 1 of 5', title: 'The clock is a ring of eleven entries', seconds: 16,
    body: '<p>The clock is not a timer in the browser. It is 11 ordinary entries of the state vector, and exactly one of them is 1.</p><p>In W, each clock entry’s row copies the entry before it, and clock 0 copies clock 10. Every update therefore moves the single 1 one step around the ring. That 11 × 11 block of W is a <b>cyclic permutation matrix</b>, shown exactly as the compiler emitted it.</p>' },
  { id: 'clock-listen', scene: 'listen', eyebrow: 'Side tour · the 11-phase clock · 2 of 5', title: 'Instructions listen for one phase', seconds: 16,
    body: '<p>An instruction’s program counter stays 1 for a whole lap of the clock. To act at one particular moment, a row ANDs the program counter with a single clock entry: <code>dispatch = ReLU(pc + clock₉ − 1)</code> is 1 only in the update after phase 9, and only for the active instruction.</p><p>The dispatch pulse then does two things at once: it subtracts itself from this line’s program counter and adds itself to the next line’s. That hand-off is how control moves from line to line.</p>' },
  { id: 'clock-phases', scene: 'phases', eyebrow: 'Side tour · the 11-phase clock · 3 of 5', title: 'One instruction, eleven ticks', seconds: 24,
    body: '<p>Here is <code>let t = a + b;</code> from the Fibonacci program, on its third loop iteration, phase by phase.</p><p>The operands are selected at phase 2 and pass through a three-layer gate. They are summed into operand registers at phase 6, and the ALU computes <code>a + b − c</code> at phase 7. The result then travels through a second gate while the old value of t is gated out, and both land together when the clock returns to phase 0.</p><p>Every entry listed is a real coordinate of the compiled matrix, nonzero at exactly that tick.</p>' },
  { id: 'clock-gate', scene: 'gate', eyebrow: 'Side tour · the 11-phase clock · 4 of 5', title: 'Why a gate takes three ticks', seconds: 14,
    body: '<p>A gate passes a value only while its selector is 1. Weights in W are signed 32-bit numbers, so the largest is H = 2,147,483,647. A value, though, can be as large as 4,294,967,295 = 2H + 1, so one subtraction of H cannot clear it.</p><p>The gate spreads the job over three ReLU layers that subtract H, H and 1. That clears even the largest value when the selector is 0, and passes it unchanged when the selector is 1. Each layer costs one update, because ReLU is applied exactly once per update. Values that fit within H use one layer plus two plain delays, so they arrive on the same schedule.</p>' },
  { id: 'clock-why', scene: 'why', eyebrow: 'Side tour · the 11-phase clock · 5 of 5', title: 'Why eleven?', seconds: 12,
    body: '<p>Line up the stages of one instruction and count updates: the program counter turns on (1), selectors sample the clock (1), the read gate (3), the operand sum (1), the ALU (1), the write gate (3), and the commit (1). That is 11.</p><p>Every kind of instruction (assignment, branch, call, return) hands control on at the same moment, as the clock wraps to phase 0, so one shared clock drives them all. Programs that do not need it, like the six-entry parity checker, are compiled without a clock at all.</p>' },
  { id: 'clock-back', scene: 'ring', eyebrow: 'Side tour · the end', title: 'Back to the main tour', seconds: 8,
    body: '<p>That is the whole clock: a ring of eleven entries, rows that AND it with program counters, and gates that take three ticks each.</p><p>To see a real one, open the Hello preset in the lab and search Inspect for <code>clock</code>.</p><p class="t-cta"><a class="t-button t-primary" href="./tour.html#lab-presets">Continue the main tour</a><a class="t-button" href="./?preset=hello">Open Hello in the lab</a></p>' },
];
const side = new URLSearchParams(location.search).get('tour') === 'clock';
const chapters = side ? clockTour : mainTour;
if (side) document.title = 'Matrix Lab · The 11-phase clock';

const tour = document.querySelector<HTMLElement>('#tour')!;
const header = el('header', 't-header');
header.innerHTML = '<a class="t-brand" href="./" aria-label="Matrix Lab"><span class="t-brand-icon" aria-hidden="true">▦</span><span class="t-brand-text"> MATRIX <strong>LAB</strong></span> <span class="t-brand-sub"></span></a>';
header.querySelector('.t-brand-sub')!.textContent = side ? 'Side tour' : 'Tour';
const segments = el('nav', 't-segments');
segments.setAttribute('aria-label', 'Chapters');
const playButton = el('button', 't-play', '▶ Play');
playButton.type = 'button'; playButton.setAttribute('aria-pressed', 'false'); playButton.title = 'Play the tour as a movie (Space)';
const previousButton = el('button', 't-step-button', '‹');
previousButton.type = 'button'; previousButton.title = 'Previous chapter (←)'; previousButton.setAttribute('aria-label', 'Previous chapter');
const nextButton = el('button', 't-step-button t-next', 'Next ›');
nextButton.type = 'button'; nextButton.title = 'Next chapter (→)'; nextButton.setAttribute('aria-label', 'Next chapter');
const labLink = el('a', 't-lab-link', side ? '← Main tour' : 'Open the lab →'); labLink.href = side ? './tour.html#control' : './';
header.append(segments, previousButton, nextButton, playButton, labLink);

const stage = el('div', 't-stage');
stage.setAttribute('aria-hidden', 'true');
const factories: Record<string, () => Scene> = {
  hero: heroScene, state: stateScene, matrix: matrixScene, multiply: multiplyScene, relu: reluScene, loop: loopScene,
  source: sourceScene, gates: gatesScene, pc: programCounterScene,
  ring: clockRingScene, listen: clockListenScene, phases: clockPhasesScene, gate: clockGateScene, why: clockWhyScene,
  lab: labScene, inspect: inspectScene, outro: outroScene,
};
// Build only this tour's scenes; each computes its data from real compiled programs.
const scenes: Record<string, Scene> = Object.fromEntries([...new Set(chapters.map(chapter => chapter.scene))].map(name => [name, factories[name]!()]));
for (const scene of Object.values(scenes)) stage.append(scene.root);
const loop = scenes.loop as ReturnType<typeof loopScene> | undefined;

const steps = el('div', 't-steps');
const articles = chapters.map((chapter, index) => {
  const article = el('article', 't-step');
  article.id = chapter.id;
  article.innerHTML = `<p class="t-eyebrow"></p><h2></h2><div class="t-body">${chapter.body}</div>`;
  article.querySelector('.t-eyebrow')!.textContent = chapter.eyebrow;
  article.querySelector('h2')!.textContent = chapter.title;
  const following = chapters[index + 1];
  if (following) {
    const next = el('button', 't-chapter-next');
    next.type = 'button';
    next.append(el('span', '', 'Next'), document.createTextNode(`${following.title} →`));
    next.addEventListener('click', () => go(index + 1));
    article.append(next);
  }
  const segment = el('a', 't-segment');
  segment.href = `#${chapter.id}`; segment.title = chapter.title; segment.setAttribute('aria-label', `${index + 1}. ${chapter.title}`);
  segment.append(el('span', 't-segment-fill'));
  segment.addEventListener('click', event => { event.preventDefault(); pause(); go(index); });
  segments.append(segment);
  steps.append(article);
  return article;
});
const layout = el('main', 't-layout');
layout.append(stage, steps);
tour.append(header, layout);

let active = -1;
let controller: AbortController | undefined;
let playing = false;
let advance: number | undefined;
let scrolling: number | undefined;
// Where an in-flight chapter scroll is heading, so repeated Next presses keep advancing.
let destination: number | undefined;

function activate(index: number): void {
  if (index === active) return;
  const chapter = chapters[index]!;
  active = index;
  controller?.abort();
  controller = new AbortController();
  articles.forEach((article, item) => article.classList.toggle('t-active', item === index));
  [...segments.children].forEach((segment, item) => {
    segment.classList.toggle('t-done', item < index);
    segment.classList.toggle('t-current', item === index);
    if (item === index) segment.setAttribute('aria-current', 'step'); else segment.removeAttribute('aria-current');
  });
  previousButton.disabled = index === 0;
  nextButton.disabled = index === chapters.length - 1;
  for (const [name, scene] of Object.entries(scenes)) scene.root.classList.toggle('t-visible', name === chapter.scene);
  scenes[chapter.scene]!.enter(controller.signal, chapter.beat);
  history.replaceState(null, '', `#${chapter.id}`);
  if (playing) schedule();
}

/** The chapter whose middle is nearest the reading line (lower on phones, under the stage). */
function track(): void {
  const line = innerHeight * (matchMedia('(max-width: 899px)').matches ? .72 : .5);
  let best = 0, distance = Infinity;
  articles.forEach((article, index) => {
    const box = article.getBoundingClientRect();
    const gap = Math.abs(box.top + Math.min(box.height, innerHeight) / 2 - line);
    if (gap < distance) { distance = gap; best = index; }
  });
  activate(best);
}
let queued = false;
addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; track(); }); } }, { passive: true });
addEventListener('resize', track);

function stopScrolling(): void {
  if (scrolling !== undefined) cancelAnimationFrame(scrolling);
  scrolling = undefined; destination = undefined;
}
/**
 * An eased scroll to a chapter. Unlike native smooth scrolling, any wheel, touch or key
 * input cancels it at once, and it reports exactly when it lands.
 */
function go(index: number, smooth = true): void {
  stopScrolling();
  destination = Math.max(0, Math.min(articles.length - 1, index));
  const target = articles[destination]!;
  const from = scrollY;
  const to = Math.min(target.getBoundingClientRect().top + scrollY - parseFloat(getComputedStyle(target).scrollMarginTop), document.documentElement.scrollHeight - innerHeight);
  if (!smooth || document.hidden || matchMedia('(prefers-reduced-motion: reduce)').matches) { scrollTo(0, to); destination = undefined; track(); return; }
  const start = performance.now(), duration = Math.min(1400, 350 + Math.abs(to - from) * .12);
  const frame = (now: number) => {
    const progress = Math.min(1, (now - start) / duration);
    scrollTo(0, from + (to - from) * (1 - (1 - progress) ** 3));
    if (progress < 1) scrolling = requestAnimationFrame(frame);
    else { scrolling = undefined; destination = undefined; track(); }
  };
  scrolling = requestAnimationFrame(frame);
}

/** Play turns the chapters into a movie: each holds for its duration, then the next scrolls in. */
function schedule(): void {
  clearTimeout(advance);
  const chapter = chapters[active]!;
  const fill = segments.children[active]?.querySelector<HTMLElement>('.t-segment-fill');
  segments.querySelectorAll<HTMLElement>('.t-segment-fill').forEach(item => { item.style.animation = 'none'; });
  if (fill) { void fill.offsetWidth; fill.style.animation = `t-segment ${chapter.seconds}s linear forwards`; }
  advance = window.setTimeout(() => { if (active < chapters.length - 1) go(active + 1); else pause(); }, chapter.seconds * 1000);
}
function start(): void {
  playing = true;
  playButton.textContent = 'Ⅱ Pause'; playButton.setAttribute('aria-pressed', 'true');
  document.body.classList.add('t-playing');
  if (active >= chapters.length - 1) go(0); else schedule();
}
function pause(): void {
  if (!playing) return;
  playing = false;
  clearTimeout(advance);
  playButton.textContent = '▶ Play'; playButton.setAttribute('aria-pressed', 'false');
  document.body.classList.remove('t-playing');
  segments.querySelectorAll<HTMLElement>('.t-segment-fill').forEach(item => { item.style.animation = 'none'; });
}
playButton.addEventListener('click', () => { if (playing) pause(); else start(); });
// Next and previous never wait for the chapter's animation; during Play they skip ahead and keep playing.
previousButton.addEventListener('click', () => go((destination ?? active) - 1));
nextButton.addEventListener('click', () => go((destination ?? active) + 1));
// Taking over the scroll hands control back to the viewer, even mid-way through an automatic scroll.
function takeOver(): void { pause(); stopScrolling(); }
for (const type of ['wheel', 'touchstart'] as const) addEventListener(type, takeOver, { passive: true });
addEventListener('keydown', event => {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  const target = event.target as HTMLElement;
  if (target.closest('input, textarea, select')) return;
  if (event.key === ' ' && !target.closest('button, a')) { event.preventDefault(); if (playing) pause(); else start(); return; }
  if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); go((destination ?? active) + (event.key === 'ArrowRight' ? 1 : -1)); return; }
  if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End'].includes(event.key)) takeOver();
});

steps.querySelectorAll<HTMLButtonElement>('[data-n]').forEach(button => button.addEventListener('click', () => {
  steps.querySelectorAll('[data-n]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
  loop?.setInput(Number(button.dataset.n));
  pause();
}));
steps.querySelector('[data-replay]')?.addEventListener('click', () => { go(0); start(); });

const initial = chapters.findIndex(chapter => `#${chapter.id}` === location.hash);
if (initial > 0) go(initial, false); else activate(0);
requestAnimationFrame(track);
