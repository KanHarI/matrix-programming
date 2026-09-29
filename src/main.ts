import './style.css';
import './execution-workspace.css';
import './matrix-inspector.css';
import './workspace-tabs.css';
import './compiler-options.css';
import './debugger.css';
import { matrixPython, vectorPython } from './matrix-copy';
import { activeMarkers, breakpointCondition, diagnosticLine, lineStepCondition, markerLines, stateChanges, type StopCondition, type StopReason } from './debugger';
import { InstructionList } from './instruction-list';
import { compile } from './compiler';
import { optimizationDefinitions, resolveOptimizations, type OptimizationFlags, type OptimizationKey } from './compiler-options';
import { examples } from './examples';
import { Machine, createWasmBackend } from './runtime';
import type { Artifact } from './core/types';
import { MatrixInspector } from './matrix-inspector';
import { MathOverview } from './math-overview';

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <header class="masthead">
    <a class="brand" href="./" aria-label="Matrix Lab home"><span class="brand-icon" aria-hidden="true">▦</span> MATRIX <strong>LAB</strong><span class="version">early preview</span></a>
    <nav class="masthead-links" aria-label="Site"><a class="tour-link" href="./tour.html"><span class="tour-link-full">Take the tour</span><span class="tour-link-short">Tour</span> <span aria-hidden="true">▶</span></a>
    <a class="repo-link" href="https://github.com/KanHarI/matrix-programming" target="_blank" rel="noreferrer" aria-label="GitHub repository" title="Source and design on GitHub"><svg viewBox="0 0 16 16" width="24" height="24" aria-hidden="true" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.65 7.65 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/></svg></a></nav>
  </header>
  <main>
    <section class="intro">
      <div><p class="eyebrow">A SMALL LANGUAGE. A VISIBLE MACHINE.</p><h1>Watch a program <em>become a matrix.</em></h1><p class="intro-copy">One fixed matrix. One state vector. Every step in the open.</p></div>
      <div class="equation" aria-label="Next state equals ReLU of the matrix times the current state">x<span class="sub">t+1</span> = <span class="relu-label">ReLU</span>(W x<span class="sub">t</span>)<small>32-bit state · exact accumulation</small></div>
    </section>
    <div class="workspace">
      <section class="panel source-panel" aria-labelledby="program-heading">
        <div class="panel-heading"><h2 id="program-heading">Program</h2><span class="language-label">MATRIX SOURCE</span></div>
        <div class="program-picker"><div class="preset-intro"><h2 id="preset-heading">Choose a program</h2><p>Each preset compiles to its own fixed matrix. Choosing one opens its source in Program; <strong>Compile &amp; reset</strong> then opens Run, paused at tick 0. New here? <a href="./tour.html">Take the two-minute guided tour</a>.</p></div><div id="preset-gallery" class="preset-gallery" role="list" aria-labelledby="preset-heading"></div></div>
        <div id="parameters" class="parameters"></div>
        <div class="editor-heading"><span>source.matrix</span><span id="active-source">No active instruction</span></div>
        <div class="editor-wrap"><div id="line-numbers" aria-hidden="true"></div><textarea id="source" spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="Program source"></textarea></div>
        <div class="editor-footer"><span id="dirty">Ready to compile</span><button id="compile" class="primary" title="Compile, reset to tick 0, and open Run (Ctrl/⌘ + Enter)">Compile & reset <span aria-hidden="true">↗</span></button></div>
        <div id="error" class="error" role="alert" hidden></div>
        <details class="device-config"><summary>Optional devices <span>Only used devices add coordinates</span></summary><div class="device-checks"><label><input type="checkbox" id="enable-led" checked /> Result LED</label><label><input type="checkbox" id="enable-output" checked /> Console output</label><label><input type="checkbox" id="enable-input" checked /> Console input</label><label><input type="checkbox" id="enable-screen" checked /> 16 × 16 screen</label></div><p>The end gate is always available. Console and screen changes apply on compile. The LED toggles immediately, observes a coordinate, and adds no matrix rows.</p></details>
        <details class="compiler-config"><summary>Compiler options <span id="optimization-summary"></span></summary><p class="optimization-intro">Compare how each optimization changes the matrix. Selections apply only with <strong>Compile &amp; reset</strong> and stay selected when switching presets. A pass only affects programs or compiler paths it supports.</p><div class="optimization-actions" role="group" aria-label="Set compiler optimizations"><button id="optimizations-enable-all" type="button">Enable all</button><button id="optimizations-disable-all" type="button">Disable all</button><button id="optimizations-defaults" type="button">Restore defaults</button></div><div id="optimization-groups" class="optimization-groups"></div><p class="optimization-pending-note">Changing flags does not modify the currently compiled matrix. Matrix size, execution time, and intermediate vectors may change after compilation. Loop summarization is off by default because it changes the stepping trace.</p></details>
      </section>
      <div class="machine-column">
        <section class="panel machine-panel" aria-labelledby="machine-heading">
          <div class="panel-heading"><h2 id="machine-heading">Execution</h2><span id="backend" class="backend">Loading WASM…</span></div>
          <div class="machine-stats"><div><strong id="dimensions">—</strong><span>matrix</span></div><div><strong id="nonzero">—</strong><span>nonzero</span></div><div><strong id="contexts">—</strong><span>contexts</span></div><div><strong id="tick">0</strong><span>ticks</span></div></div>
          <div class="transport"><div class="transport-buttons"><button id="phase-step" class="primary" data-key="." aria-keyshortcuts="." title="Next phase: Multiply, Apply ReLU, then Commit (.)">Multiply →</button><button id="step" data-key="T" aria-keyshortcuts="t" title="Commit one complete matrix update (T)">Full tick</button><button id="step-line" data-key="L" aria-keyshortcuts="l" title="Run until execution reaches a different source line (L)">Step line</button><button id="run" data-key="R" aria-keyshortcuts="r" title="Run or pause; stops at breakpoints (R)">▶ Run</button><button id="reset" class="icon-button" aria-label="Reset execution" title="Reset execution">↺</button></div><span class="status-group"><span id="status" class="status">Not compiled</span><span id="pause-reason" class="pause-reason" role="status" hidden></span></span></div>
          <div class="phase-track" aria-label="Execution phases"><div data-phase="ready"><b>1</b><span>Current state<small>xₜ · unsigned 32-bit</small></span></div><i>→</i><div data-phase="multiplied"><b>2</b><span>Multiply<small>W xₜ · signed sums</small></span></div><i>→</i><div data-phase="rectified"><b>3</b><span>Apply ReLU<small>max(0, sum)</small></span></div></div>
          <p id="phase-explanation" class="phase-explanation">Compile a program to inspect its matrix.</p>
          <div id="active-contexts" class="active-contexts" aria-label="Active execution contexts"></div>
        </section>
        <section class="panel inspector-panel" aria-labelledby="inspector-heading">
          <div class="panel-heading"><h2 id="inspector-heading">Matrix and state</h2><div class="view-tabs"><button id="vector-tab" class="selected" aria-pressed="true">Vector</button><button id="matrix-tab" aria-pressed="false">Matrix</button></div></div>
          <div class="inspector-toolbar"><input id="filter" type="search" placeholder="Find a coordinate…" aria-label="Filter coordinates" /><label><input id="internals" type="checkbox" /> Internal circuitry</label><label><input id="changed" type="checkbox" /> Changed only</label></div>
          <div id="vector-view"><div class="vector-scroll"><table><thead><tr><th scope="col">Coordinate</th><th scope="col">Current xₜ</th><th scope="col">Before ReLU</th><th scope="col">After ReLU</th></tr></thead><tbody id="vector-body"></tbody></table></div><div class="table-footer"><span id="visible-count">No coordinates yet</span><span><i class="legend-negative"></i> negative <i class="legend-clipped"></i> clamped to zero</span></div></div>
          <div id="matrix-view"><div id="matrix-inspector"></div><details class="matrix-overview"><summary>Sparsity overview</summary><div class="matrix-explanation"><p>Overview of <strong>W</strong>: every dot is a nonzero weight. At this scale several cells may overlap. Inspect exact values in the grid above.</p><span><i class="legend-positive"></i> positive <i class="legend-negative"></i> negative</span></div><canvas id="matrix-canvas" width="640" height="400" aria-label="Sparse matrix weight visualization"></canvas><p id="matrix-hover">Click the overview to navigate to a row and column.</p></details></div>
          <div class="row-detail"><p class="eyebrow">FOLLOW THE CALCULATION</p><h3 id="row-name">Select a coordinate</h3><div id="row-meta" class="row-meta"></div><div id="row-calculation">Click any vector row to see exactly where its next value comes from.</div></div>
        </section>
        <section class="outputs" aria-label="Output devices">
          <div class="panel console-panel"><div class="panel-heading"><h2><span class="terminal-mark" aria-hidden="true">&gt;_</span> Console</h2><span id="console-badge" class="device-badge">not linked</span></div><pre id="console-output" role="log" aria-live="polite" aria-label="Console output"></pre><form id="console-form"><input id="console-input" aria-label="Console input" placeholder="Type input, then press Enter" autocomplete="off" /><button id="send-input" type="submit" aria-label="Send console input">↵</button><button id="send-eof" type="button" title="Signal end of input">EOF</button></form><p id="input-hint" class="input-hint">Input is delivered only when the matrix requests it.</p></div>
          <div class="panel screen-panel"><div class="panel-heading"><h2>Pixel screen</h2><span id="screen-badge" class="device-badge">not linked</span></div><div class="screen-content"><canvas id="screen" width="16" height="16" aria-label="16 by 16 RGB output display"></canvas><div><strong>16 × 16</strong><p>One pixel per emission.<br />X, Y, R, G, B + emit.<br />Just six coordinates.</p><div class="gate"><span id="led" class="led"></span><span id="led-text">LED not linked</span></div><div class="gate end-gate"><span id="end-light" class="led"></span><span id="end-text">End gate: 0</span></div></div></div></div>
        </section>
        <details class="panel history-panel"><summary>Recent snapshots <span id="history-count">0 recorded</span></summary><ol id="history"></ol><p>Last 24 displayed commit snapshots. Run mode samples after batches; change counts compare snapshots. Previews never change state or produce I/O.</p></details>
      </div>
    </div>
    <footer>Built for understanding, not hiding the machinery.<span>All computation stays in your browser.</span></footer>
  </main>
`;

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const source = $<HTMLTextAreaElement>('source');
const optimizationInputs = new Map<OptimizationKey, HTMLInputElement>();
buildCompilerOptions();

function buildCompilerOptions(): void {
  const groups: { title: string; keys: readonly string[] }[] = [
    { title: 'Specialized compilation paths', keys: ['countdown', 'straightLine', 'counterMachine'] },
    { title: 'Control flow and comparisons', keys: ['entryElision', 'deadCode', 'jumpThreading', 'constantReturns', 'comparisonFusion', 'predicateSharing', 'counterFacts', 'counterFusion'] },
    { title: 'Registers and arithmetic', keys: ['copyCoalescing', 'scratchReuse', 'directDelta', 'constantWrites', 'constantOperands', 'prune'] },
    { title: 'ReLU circuit and timing', keys: ['boundedGates', 'sharedGateDelays', 'clockSampling'] },
    { title: 'Loop rewrites', keys: ['loopSummaries'] },
  ];
  const grouped = new Set(groups.flatMap(group => group.keys));
  groups.push({ title: 'Other optimization passes', keys: optimizationDefinitions.filter(definition => !grouped.has(definition.key)).map(definition => definition.key) });
  const defaults = resolveOptimizations();
  for (const group of groups) {
    const definitions = optimizationDefinitions.filter(definition => group.keys.includes(definition.key));
    if (!definitions.length) continue;
    const fieldset = document.createElement('fieldset'); fieldset.className = 'optimization-group';
    const legend = document.createElement('legend'); legend.textContent = group.title; fieldset.append(legend);
    const choices = document.createElement('div'); choices.className = 'optimization-group-options';
    for (const definition of definitions) {
      const input = document.createElement('input');
      input.type = 'checkbox'; input.id = definition.key === 'loopSummaries' ? 'summarize-loops' : `optimization-${definition.key}`;
      input.dataset.optimization = definition.key; input.checked = defaults[definition.key];
      const label = document.createElement('label'); label.className = 'optimization-option'; label.htmlFor = input.id;
      const copy = document.createElement('span'); copy.className = 'optimization-copy';
      const title = document.createElement('strong');
      const titleText = document.createElement('span'); titleText.id = `${input.id}-label`; titleText.textContent = definition.label; title.append(titleText);
      if (!definition.defaultEnabled) {
        const badge = document.createElement('span'); badge.className = 'optimization-default-off'; badge.textContent = 'OFF BY DEFAULT'; title.append(badge);
      }
      const description = document.createElement('span'); description.className = 'optimization-description'; description.id = `${input.id}-description`; description.textContent = definition.description;
      input.setAttribute('aria-labelledby', titleText.id); input.setAttribute('aria-describedby', description.id);
      input.addEventListener('change', compilerOptionsChanged);
      copy.append(title, description); label.append(input, copy); choices.append(label);
      optimizationInputs.set(definition.key, input);
    }
    fieldset.append(choices); $('optimization-groups').append(fieldset);
  }
  for (const [id, setting] of [['optimizations-enable-all', true], ['optimizations-disable-all', false], ['optimizations-defaults', null]] as const) {
    $(id).addEventListener('click', () => {
      let changed = false;
      for (const [key, input] of optimizationInputs) {
        const next = setting ?? defaults[key];
        if (input.checked !== next) { input.checked = next; changed = true; }
      }
      if (changed) compilerOptionsChanged();
    });
  }
  updateOptimizationSummary();
}
function readOptimizationFlags(): OptimizationFlags {
  const flags = resolveOptimizations();
  for (const [key, input] of optimizationInputs) flags[key] = input.checked;
  return flags;
}
function updateOptimizationSummary(): void {
  const enabled = [...optimizationInputs.values()].filter(input => input.checked).length;
  $('optimization-summary').textContent = `${enabled} / ${optimizationInputs.size} enabled`;
}
function compilerOptionsChanged(): void {
  stop(); needsCompile = true;
  updateOptimizationSummary();
  $('dirty').textContent = 'Compiler options changed · compile to apply';
  render();
}
// Put the mathematical objects and ports first; source and explanations follow.
const workspace = document.querySelector<HTMLElement>('.workspace')!;
const inspectorPanel = document.querySelector<HTMLElement>('.inspector-panel')!;
const objects = document.createElement('div'); objects.className = 'matrix-vector-layout';
const vectorSection = document.createElement('section'); vectorSection.className = 'vector-section';
const vectorHeading = document.createElement('h3'); vectorHeading.textContent = 'State vector x';
vectorSection.append(vectorHeading, document.querySelector('.inspector-toolbar')!, $('vector-view'));
objects.append($('matrix-view'), vectorSection);
inspectorPanel.append(objects);
const debug = document.createElement('section'); debug.className = 'panel detail-panel';
const detailTitle = document.createElement('h2'); detailTitle.textContent = 'Row calculation & execution history'; debug.append(detailTitle, document.querySelector('.phase-track')!, $('phase-explanation'), $('active-contexts'), document.querySelector('.row-detail')!, document.querySelector('.history-panel')!);
const below = document.createElement('div'); below.className = 'below-debug-layout'; below.append(document.querySelector('.source-panel')!, debug);
const presets = document.createElement('section'); presets.className = 'panel preset-strip'; presets.setAttribute('aria-label', 'Program preset and inputs');
presets.append(below.querySelector('.program-picker')!, below.querySelector('#parameters')!);
const machineColumn = document.querySelector('.machine-column')!;
const mathPanel = document.createElement('section'); mathPanel.className = 'panel'; mathPanel.id = 'math-overview'; mathPanel.setAttribute('aria-label', 'Mathematical matrix and vector overview');
const executionWorkspace = document.createElement('section');
executionWorkspace.className = 'panel execution-workspace';
executionWorkspace.setAttribute('aria-label', 'Matrix execution workspace');
const executionControls = document.createElement('div'); executionControls.className = 'execution-controls';
const runInputs = document.createElement('div'); runInputs.className = 'run-inputs';
runInputs.append(presets.querySelector('#parameters')!);
const copyTools = document.createElement('div'); copyTools.className = 'matrix-copy-tools';
copyTools.innerHTML = '<button id="copy-matrix-python" type="button" title="Copy every weight in W as a nested integer list, compatible with Python and JavaScript">Copy matrix to Python</button><button id="copy-input-vector" type="button" title="Copy the current committed vector xₜ, the input to the next multiplication—not a preview">Copy input vector</button><span id="copy-feedback" role="status" aria-live="polite"></span>';
runInputs.append(copyTools);
// The transport stays reachable while scrolling through W, x and the row calculation.
const toolbar = document.querySelector<HTMLElement>('.machine-panel')!; toolbar.classList.add('debug-toolbar');
executionControls.append(runInputs);
executionWorkspace.append(executionControls, mathPanel);
const sourcePanel = below.querySelector<HTMLElement>('.source-panel')!;
const outputDevices = document.querySelector<HTMLElement>('.outputs')!;
const appTabs = ['presets', 'program', 'run', 'inspect'] as const;
type AppTab = typeof appTabs[number];
let activeTab: AppTab = 'run';
const tabBar = document.createElement('nav'); tabBar.className = 'workspace-tabs'; tabBar.setAttribute('role', 'tablist'); tabBar.setAttribute('aria-label', 'Workspace');
const tabPanels = new Map<AppTab, HTMLElement>();
for (const name of appTabs) {
  const button = document.createElement('button'); button.type = 'button'; button.id = `app-tab-${name}`;
  button.textContent = name[0]!.toUpperCase() + name.slice(1); button.setAttribute('role', 'tab'); button.setAttribute('aria-controls', `app-panel-${name}`);
  button.addEventListener('click', () => selectAppTab(name));
  button.addEventListener('keydown', event => {
    const index = appTabs.indexOf(name);
    const next = event.key === 'ArrowRight' ? (index + 1) % appTabs.length : event.key === 'ArrowLeft' ? (index + appTabs.length - 1) % appTabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? appTabs.length - 1 : undefined;
    if (next === undefined) return;
    event.preventDefault(); selectAppTab(appTabs[next]!); $(`app-tab-${appTabs[next]}`).focus();
  });
  tabBar.append(button);
  const panel = document.createElement('section'); panel.id = `app-panel-${name}`; panel.className = 'workspace-tab-panel';
  panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', button.id); tabPanels.set(name, panel);
}
const inspectControls = document.createElement('div'); inspectControls.className = 'execution-workspace inspect-execution';
const inspectLayout = document.createElement('div'); inspectLayout.className = 'inspect-tab-layout';
const inspectDetails = document.createElement('div'); inspectDetails.className = 'inspect-details'; inspectDetails.append(inspectorPanel);
const instructionsPanel = document.createElement('section');
const inspectSource = document.createElement('div'); inspectSource.className = 'inspect-source'; inspectSource.append(debug, instructionsPanel);
inspectLayout.append(inspectDetails, inspectSource);
tabPanels.get('presets')!.append(presets);
tabPanels.get('program')!.append(sourcePanel);
tabPanels.get('run')!.append(executionWorkspace, outputDevices);
tabPanels.get('inspect')!.append(inspectControls, inspectLayout);
const workspaceNotice = document.createElement('div'); workspaceNotice.className = 'workspace-notice'; workspaceNotice.hidden = true;
workspaceNotice.innerHTML = '<span>Program or options changed. Compile before running.</span><button type="button">Open Program</button>';
workspaceNotice.querySelector('button')!.addEventListener('click', () => selectAppTab('program'));
const workspaceContext = document.createElement('div'); workspaceContext.className = 'workspace-context';
workspaceContext.innerHTML = '<div class="workspace-program"><span id="program-origin">Preset</span><h2 id="active-program-name"></h2></div>';
workspaceContext.append(tabBar);
workspace.replaceChildren(workspaceContext, sourcePanel.querySelector('#error')!, workspaceNotice, ...tabPanels.values());
const copyDialog = document.createElement('dialog'); copyDialog.className = 'copy-dialog'; copyDialog.id = 'copy-dialog';
copyDialog.innerHTML = '<h2>Copy manually</h2><p>Your browser did not allow clipboard access. Select and copy the text below.</p><textarea id="copy-manual-text" aria-label="Text to copy" readonly spellcheck="false"></textarea><form method="dialog"><button>Close</button></form>';
document.body.append(copyDialog);
function selectAppTab(name: AppTab, update = true): void {
  activeTab = name;
  for (const tab of appTabs) {
    const selected = tab === name, button = $<HTMLButtonElement>(`app-tab-${tab}`);
    button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1;
    tabPanels.get(tab)!.hidden = !selected;
  }
  (name === 'inspect' ? inspectSource : tabPanels.get('program')!).append(sourcePanel);
  if (name === 'inspect') inspectControls.append(executionControls);
  else executionWorkspace.prepend(executionControls);
  if (name === 'run' || name === 'inspect') tabPanels.get(name)!.prepend(toolbar);
  if (update) render();
}
selectAppTab('run', false);
machineColumn.remove();
const mathOverview = new MathOverview(mathPanel, row => inspectRegister(row));
const matrixInspector = new MatrixInspector($('matrix-inspector'), row => {
  selectedRow = row; expandedTerms = false; renderVector(); renderCalculation(); renderMatrix();
});
const instructionList = new InstructionList(instructionsPanel, {
  toggleBreakpoint: line => toggleBreakpoint(line),
  inspectRegister: register => inspectRegister(register),
  revealLine: line => revealLine(line),
});
/** Open a coordinate's exact row calculation and bring it into view. */
function inspectRegister(row: number): void {
  selectAppTab('inspect');
  matrixInspector.inspect(row, 0);
  const detail = document.querySelector<HTMLElement>('.row-detail')!;
  // Smooth scrolling is frame-driven and would stall in a hidden tab.
  detail.scrollIntoView({ block: 'start', behavior: document.hidden || matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  detail.classList.remove('row-detail-flash'); void detail.offsetWidth; detail.classList.add('row-detail-flash');
}
/** Select and scroll to a source line in the editor; move keyboard focus only when asked. */
function revealLine(line: number, focus = false, fallback: 'inspect' | 'program' = 'inspect'): void {
  if (activeTab !== 'inspect' && activeTab !== 'program') selectAppTab(fallback);
  const lines = source.value.split('\n');
  const start = lines.slice(0, Math.max(0, line - 1)).reduce((sum, text) => sum + text.length + 1, 0);
  if (focus) source.focus();
  source.setSelectionRange(start, start + (lines[line - 1]?.length ?? 0));
  const lineHeight = parseFloat(getComputedStyle(source).lineHeight) || 20;
  source.scrollTop = Math.max(0, (line - 1) * lineHeight - source.clientHeight / 3);
  updateGutter();
}
let artifact: Artifact | undefined;
let machine: Machine | undefined;
let backend: Awaited<ReturnType<typeof createWasmBackend>> | undefined;
let running = false;
let selectedRow = 0;
let matrixView = true;
let lastRender = 0;
let lastRecordedTick = -1;
let history: { tick: number; result: number | undefined; active: string; changes: number; detail: string }[] = [];
let displayedFault: string | undefined;
let previousState: Uint32Array | undefined;
let recentChanges = new Set<number>();
let needsCompile = false;
let invalidParameters = false;
let expandedTerms = false;
let batchSize = 256;
let playIntent = false;
let composingInput = false;
let frame: { kind: 'animation' | 'timeout'; id: number } | undefined;
// Source lines where Run and Step line pause when one of the line's instructions begins.
const breakpoints = new Set<number>();
let playMode: 'run' | 'line' = 'run';
let stopCondition: StopCondition | undefined;
let pauseReason = '';
let errorLine: number | undefined;

function cancelFrame(): void {
  if (frame?.kind === 'animation') cancelAnimationFrame(frame.id);
  else if (frame) clearTimeout(frame.id);
  frame = undefined;
}
// Animation frames never fire in a hidden tab; a started run keeps progressing on timers.
function scheduleFrame(): void {
  cancelFrame();
  frame = document.hidden ? { kind: 'timeout', id: window.setTimeout(() => runFrame(performance.now()), 0) } : { kind: 'animation', id: requestAnimationFrame(runFrame) };
}
function stop(): void { running = false; playIntent = false; stopCondition = undefined; cancelFrame(); }
function describeStop(reason: StopReason): string {
  return reason.kind === 'breakpoint' ? `Breakpoint · line ${reason.line}` : `Line ${reason.lines.join(', ')}`;
}
function watchConditions(): StopCondition | undefined {
  if (!artifact || !machine) return undefined;
  const conditions = [breakpointCondition(artifact, breakpoints, machine.state), playMode === 'line' ? lineStepCondition(artifact, machine.state) : undefined].filter((condition): condition is StopCondition => Boolean(condition));
  if (!conditions.length) return undefined;
  // Every condition observes every commit, so breakpoint edge detection stays current.
  return state => conditions.map(condition => condition(state)).find(Boolean);
}
function beginPlaying(mode?: 'run' | 'line'): void {
  if (!machine || needsCompile || invalidParameters || machine.status === 'ended' || machine.status === 'fault') return;
  if (mode) playMode = mode;
  playIntent = true; pauseReason = '';
  if (!running) { running = true; stopCondition = watchConditions(); render(); scheduleFrame(); }
}
function setError(error?: unknown, actions: HTMLElement[] = []): void {
  const container = $('error');
  const message = error instanceof Error ? error.message : error ? String(error) : '';
  container.hidden = !error;
  const text = document.createElement('p'); text.className = 'error-message'; text.textContent = message;
  const row = document.createElement('div'); row.className = 'error-actions'; row.append(...actions); row.hidden = !actions.length;
  container.replaceChildren(text, row);
  displayedFault = undefined;
}
function actionButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}
/** Compiler/parser diagnostics link to their line; runtime faults link to their source and coordinate. */
function showError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  errorLine = diagnosticLine(message);
  setError(error, errorLine === undefined ? [] : [actionButton(`Show line ${errorLine}`, () => revealLine(errorLine!, true, 'program'))]);
}
function showFault(): void {
  if (!machine?.error || !artifact) return;
  const actions: HTMLElement[] = [];
  const markers = activeMarkers(artifact, machine.state);
  if (markers.length) {
    const where = document.createElement('span'); where.className = 'error-location';
    where.textContent = `While executing ${markers.slice(0, 3).map(marker => `line ${marker.line} (${marker.context}: ${marker.label})`).join(', ')}`;
    actions.push(where, actionButton(`Show line ${markers[0]!.line}`, () => revealLine(markers[0]!.line)));
  }
  const register = machine.faultRegister;
  if (register !== null) actions.push(actionButton(`Inspect ${artifact.registers[register]!.name}`, () => inspectRegister(register)));
  setError(machine.error, actions);
  displayedFault = machine.error;
}
function toggleBreakpoint(line: number): void {
  if (breakpoints.has(line)) breakpoints.delete(line); else breakpoints.add(line);
  // A run in progress watches the new set from its current state onward.
  if (running) stopCondition = watchConditions();
  updateGutter(); renderBreakpoints();
}
function renderBreakpoints(): void {
  instructionList.render(needsCompile ? undefined : artifact, machine?.state, breakpoints);
}
function updateGutter(): void {
  const compiled = artifact && machine && !needsCompile;
  const active = new Set(compiled ? activeMarkers(artifact!, machine!.state).map(marker => marker.line) : []);
  const breakable = compiled ? markerLines(artifact!) : new Set<number>();
  const gutter = $('line-numbers');
  gutter.replaceChildren(...source.value.split('\n').map((_, index) => {
    const number = index + 1;
    const line = document.createElement('span');
    line.textContent = String(number);
    line.classList.toggle('active-line', active.has(number));
    line.classList.toggle('breakable', breakable.has(number));
    line.classList.toggle('breakpoint', breakpoints.has(number));
    line.classList.toggle('breakpoint-unbound', breakpoints.has(number) && Boolean(compiled) && !breakable.has(number));
    line.classList.toggle('error-line', errorLine === number);
    line.dataset.line = String(number);
    line.title = breakpoints.has(number) ? (compiled && !breakable.has(number) ? 'Breakpoint without a compiled instruction on this line · click to remove' : 'Breakpoint · click to remove') : breakable.has(number) ? 'Click to pause when this line starts (F9)' : '';
    return line;
  }));
  gutter.scrollTop = source.scrollTop;
}
function inputValues(): Record<string, number> {
  return Object.fromEntries([...document.querySelectorAll<HTMLInputElement>('[data-parameter]')].map(input => {
    const n = Number(input.value);
    if (!input.value.trim() || !Number.isInteger(n) || n < 0 || n > 0xffff_ffff) throw new Error(`${input.dataset.parameter} must be an integer between 0 and 4,294,967,295.`);
    return [input.dataset.parameter!, n];
  }));
}
function resetHistory(): void { history = []; previousState = undefined; lastRecordedTick = -1; recentChanges = new Set(); }
function compileProgram(): void {
  stop();
  setError();
  try {
    const result = compile(source.value, {
      name: examples.find(example => example.source === source.value)?.name ?? 'Custom program',
      optimizations: readOptimizationFlags(),
      devices: {
        consoleOutput: $<HTMLInputElement>('enable-output').checked,
        consoleInput: $<HTMLInputElement>('enable-input').checked,
        screen: $<HTMLInputElement>('enable-screen').checked,
        // LED is a host-only observer. Preserve its binding when hidden.
        led: true,
      },
    });
    const values = inputValues();
    invalidParameters = false;
    // Source edits may change main's parameters; preserve matching values only.
    const validInputs = Object.fromEntries(Object.keys(result.inputs).map(name => [name, values[name] ?? 0]));
    const next = new Machine(result, validInputs, backend);
    artifact = result;
    machine = next;
    needsCompile = false;
    $('copy-feedback').textContent = '';
    renderParameters(validInputs);
    resetHistory();
    selectedRow = result.result ?? result.end;
    errorLine = undefined; pauseReason = '';
    $('dirty').textContent = 'Compiled · fixed sparse matrix';
  } catch (error) {
    showError(error);
    // Never let an invalid editor buffer appear to be the running program.
    machine = undefined;
    artifact = undefined;
    needsCompile = true;
    $('dirty').textContent = 'Compilation failed';
  }
  render();
}
function renderParameters(values: Record<string, number>): void {
  const container = $('parameters');
  container.replaceChildren(...Object.entries(values).map(([name, value]) => {
    const label = document.createElement('label');
    label.textContent = name;
    const input = document.createElement('input');
    input.type = 'number'; input.min = '0'; input.max = '4294967295'; input.step = '1'; input.value = String(value); input.dataset.parameter = name;
    input.addEventListener('input', resetParameters);
    label.append(input);
    return label;
  }));
  container.hidden = !Object.keys(values).length;
}
function resetParameters(): void {
  stop();
  try {
    const values = inputValues();
    invalidParameters = false;
    setError();
    // Parameters initialize x, not W. Keep pending source/device edits dirty.
    if (machine && !needsCompile) {
      machine.reset(values);
      resetHistory();
      $('dirty').textContent = 'Input applied · execution reset';
    }
  } catch (error) {
    invalidParameters = true;
    setError(error);
  }
  render();
}
function chooseExample(id: string): void {
  const example = examples.find(item => item.id === id) ?? examples[0]!;
  source.value = example.source;
  // Breakpoints belong to the previous program's lines.
  breakpoints.clear();
  renderParameters(example.inputs);
  source.scrollTop = 0;
  // Presets describe actual linked hardware, not the last preset's allowances.
  try {
    const preset = compile(example.source, { optimizations: readOptimizationFlags() });
    $<HTMLInputElement>('enable-output').checked = Boolean(preset.devices.consoleOutput);
    $<HTMLInputElement>('enable-input').checked = Boolean(preset.devices.consoleInput);
    $<HTMLInputElement>('enable-screen').checked = Boolean(preset.devices.screen);
    $<HTMLInputElement>('enable-led').checked = preset.led !== undefined;
  } catch (error) { setError(error); }
  compileProgram();
  // Read the source first; Compile & reset continues to Run.
  selectAppTab('program');
}
/** From Program, a successful compile continues to Run; an error stays beside the source. */
function compileFromEditor(): void {
  compileProgram();
  if (activeTab === 'program' && artifact && !needsCompile) selectAppTab('run');
}

function execute(action: () => unknown): void {
  if (!machine) return;
  setError(); pauseReason = '';
  try { action(); } catch (error) { stop(); setError(error); }
  if (machine.status !== 'ready') stop();
  render();
}
function runFrame(time: number): void {
  frame = undefined;
  if (!running || !machine) return;
  let reason: StopReason | undefined;
  try {
    const start = performance.now();
    if (stopCondition) {
      for (let i = 0; i < batchSize && machine.step(); i++) {
        reason = stopCondition(machine.state);
        if (reason) break;
      }
    } else machine.runBatch(batchSize);
    // Target short batches so even a much larger edited matrix remains pausable.
    // Hidden tabs wake rarely, so each wake-up does more work.
    const elapsed = Math.max(performance.now() - start, 0.5);
    const target = document.hidden ? 250 : 8;
    batchSize = Math.max(8, Math.min(document.hidden ? 1 << 20 : 2048, Math.round(batchSize * target / elapsed)));
    if (reason) { stop(); pauseReason = describeStop(reason); }
    else if (machine.status === 'waiting') running = false;
    else if (machine.status !== 'ready') stop();
  } catch (error) { stop(); setError(error); }
  if (!running || (!document.hidden && time - lastRender > 90)) { render(); lastRender = time; }
  if (reason) followExecution();
  if (running) scheduleFrame();
}
/** After a line step or breakpoint, show where execution paused. */
function followExecution(): void {
  if (!artifact || !machine) return;
  const line = activeMarkers(artifact, machine.state)[0]?.line;
  if (line === undefined) return;
  if (activeTab === 'inspect' || activeTab === 'program') revealLine(line);
  instructionList.focusLine(line);
}

function addCell(row: HTMLTableRowElement, text: string, className = ''): HTMLTableCellElement {
  const cell = document.createElement('td'); cell.textContent = text; cell.className = className; row.append(cell); return cell;
}
function renderVector(): void {
  const body = $('vector-body');
  body.replaceChildren();
  if (!artifact || !machine) { $('visible-count').textContent = 'No compiled matrix'; return; }
  const filter = $<HTMLInputElement>('filter').value.toLowerCase();
  const internals = $<HTMLInputElement>('internals').checked;
  const changed = $<HTMLInputElement>('changed').checked;
  let matching = 0, hidden = 0;
  const fragments = document.createDocumentFragment();
  artifact.registers.forEach((register, index) => {
    // A typed search is explicit: it also finds compiler-internal circuitry.
    if (!filter && !internals && artifact!.registers.length > 64 && (register.kind === 'temporary' || register.kind === 'control' || register.kind === 'constant' || register.name.includes('.$')) && index !== artifact!.end && index !== selectedRow) { hidden++; return; }
    if (filter && !`${register.name} ${index} ${register.context ?? ''}`.toLowerCase().includes(filter)) return;
    const candidate = machine!.candidate?.[index];
    const current = machine!.state[index]!;
    if (changed && (candidate === undefined ? !recentChanges.has(index) : candidate === BigInt(current))) return;
    matching++;
    if (matching > 160) return;
    const raw = machine!.raw?.[index];
    const row = document.createElement('tr'); row.tabIndex = 0; row.className = selectedRow === index ? 'selected-row' : '';
    row.setAttribute('aria-label', `${register.name}, coordinate ${index}`);
    row.addEventListener('click', () => { selectedRow = index; expandedTerms = false; renderVector(); renderCalculation(); if (matrixView) renderMatrix(); });
    row.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); row.click(); } });
    const name = addCell(row, '');
    const indexElement = document.createElement('span'); indexElement.className = 'coordinate-index'; indexElement.textContent = String(index);
    const nameElement = document.createElement('span'); nameElement.textContent = register.name; nameElement.title = register.name;
    name.append(indexElement, nameElement);
    if (index === artifact!.end || index === artifact!.led) {
      const badge = document.createElement('small'); badge.className = 'coordinate-badge'; badge.textContent = index === artifact!.end ? 'END' : 'LED'; name.append(badge);
    }
    addCell(row, String(current));
    addCell(row, raw === undefined ? '—' : String(raw), raw !== undefined && raw < 0n ? 'negative-value' : '');
    addCell(row, candidate === undefined ? '—' : String(candidate), candidate !== undefined && candidate > BigInt(register.bound) ? 'negative-value' : raw !== undefined && raw < 0n && candidate !== undefined ? 'clipped-value' : candidate !== undefined && candidate !== BigInt(current) ? 'changed-value' : '');
    fragments.append(row);
  });
  body.append(fragments);
  $('visible-count').textContent = `${Math.min(matching, 160)} of ${matching} matching · ${artifact.registers.length} total${matching > 160 ? ' · narrow the filter to see more' : ''}${hidden ? ` · ${hidden} internal hidden` : ''}`;
}

function renderCalculation(): void {
  const details = $('row-calculation');
  if (!artifact || !machine) { $('row-name').textContent = 'Select a coordinate'; details.textContent = 'Compile a program, then click a vector row.'; return; }
  const register = artifact.registers[selectedRow];
  const row = artifact.rows[selectedRow];
  if (!register || !row) return;
  $('row-name').textContent = `[${selectedRow}] ${register.name}`;
  renderRowMeta(register);
  details.replaceChildren();
  const terms = document.createElement('div'); terms.className = 'calculation-terms';
  const displayed = expandedTerms ? row.cols : row.cols.slice(0, 48);
  displayed.forEach((column, termIndex) => {
    const weight = row.weights[termIndex]!;
    const term = document.createElement('button'); term.className = weight < 0 ? 'term negative-term' : 'term';
    const label = document.createElement('span'); label.textContent = `${weight} × ${artifact!.registers[column]!.name}`;
    const value = document.createElement('strong'); value.textContent = `${weight} × ${machine!.state[column]} = ${BigInt(weight) * BigInt(machine!.state[column]!)}`;
    term.append(label, value); term.title = `Inspect input coordinate ${column}`;
    term.addEventListener('click', () => { selectedRow = column; expandedTerms = false; renderVector(); renderCalculation(); });
    terms.append(term);
  });
  if (!row.cols.length) terms.textContent = 'No matrix inputs: this row sums to 0 (unless it is an input-device latch).';
  if (row.cols.length > displayed.length) { const more = document.createElement('button'); more.textContent = `Show all ${row.cols.length} terms`; more.addEventListener('click', () => { expandedTerms = true; renderCalculation(); }); terms.append(more); }
  details.append(terms);
  const raw = machine.raw?.[selectedRow];
  const sum = row.cols.reduce((total, column, index) => total + BigInt(row.weights[index]!) * BigInt(machine!.state[column]!), 0n);
  const result = document.createElement('p'); result.className = 'calculation-result';
  result.textContent = raw === undefined ? `W row · x = ${sum}. Click Multiply to calculate the full vector.` : `${raw === sum ? 'Sum' : `W row · x = ${sum}, B · u = ${raw - sum}; total`} = ${raw} → ReLU = max(0, ${raw}) = ${raw < 0n ? 0n : raw}${raw < 0n ? ' · negative value is clipped' : ''}`;
  details.append(result);
  if (raw !== undefined && raw > BigInt(register.bound)) {
    const overflow = document.createElement('p'); overflow.className = 'calculation-overflow';
    overflow.textContent = `Exceeds this coordinate's bound of ${register.bound.toLocaleString()} by ${(raw - BigInt(register.bound)).toLocaleString()}. The update faults instead of committing; nothing wraps.`;
    details.append(overflow);
  }
  const inputDevice = artifact.devices.consoleInput;
  if (inputDevice && [inputDevice.available, inputDevice.eof, inputDevice.codepoint].includes(selectedRow)) {
    const note = document.createElement('p'); note.textContent = 'Input latch: the reserved console packet is added through the fixed input map B before ReLU. It is consumed only on commit.'; details.append(note);
  }
}
/** Where a coordinate comes from: its kind, source line and, for program counters, the instruction. */
function renderRowMeta(register: Artifact['registers'][number]): void {
  const meta = $('row-meta');
  const marker = artifact!.markers.find(item => item.register === selectedRow);
  const line = marker?.line ?? register.line;
  const chip = (text: string) => { const element = document.createElement('span'); element.className = 'row-meta-chip'; element.textContent = text; return element; };
  const parts = [chip(marker ? 'program counter' : register.kind)];
  if (register.context) parts.push(chip(`context ${register.context}`));
  if (marker) parts.push(chip(`instruction: ${marker.label}`));
  if (selectedRow === artifact!.end) parts.push(chip('end gate'));
  if (selectedRow === artifact!.led) parts.push(chip('LED'));
  if (line !== undefined && line > 0) {
    const link = actionButton(`${marker ? 'Line' : 'From line'} ${line}`, () => revealLine(line));
    link.className = 'row-meta-line'; parts.push(link);
  }
  meta.replaceChildren(...parts);
}
function renderMatrix(): void {
  matrixInspector.setArtifact(artifact);
  const canvas = $<HTMLCanvasElement>('matrix-canvas'); const context = canvas.getContext('2d')!;
  context.fillStyle = '#f6f8f5'; context.fillRect(0, 0, canvas.width, canvas.height);
  if (!artifact) return;
  const n = artifact.rows.length;
  const width = canvas.width / n, height = canvas.height / n;
  context.fillStyle = '#d9e9c1'; context.fillRect(0, selectedRow * height, canvas.width, Math.max(height, 1));
  artifact.rows.forEach((row, destination) => row.cols.forEach((column, term) => {
    context.fillStyle = row.weights[term]! < 0 ? '#c35772' : '#278a83';
    context.fillRect(column * width, destination * height, Math.max(width, 1), Math.max(height, 1));
  }));
}
function renderOutputs(): void {
  const output = $('console-output');
  if (output.textContent !== (machine?.consoleText ?? '')) { output.textContent = machine?.consoleText ?? ''; output.scrollTop = output.scrollHeight; }
  const devices = artifact?.devices;
  const consoleLinked = Boolean(devices?.consoleOutput || devices?.consoleInput);
  document.querySelector<HTMLElement>('.console-panel')!.hidden = !consoleLinked;
  $('console-form').hidden = !devices?.consoleInput;
  $('input-hint').hidden = !devices?.consoleInput;
  $('screen').hidden = !devices?.screen;
  document.querySelector('.screen-panel h2')!.textContent = devices?.screen ? 'Pixel screen' : 'Output gates';
  document.querySelectorAll<HTMLElement>('.screen-content strong, .screen-content p').forEach(element => { element.hidden = !devices?.screen; });
  $('console-badge').textContent = consoleLinked ? [devices?.consoleOutput ? 'OUT' : '', devices?.consoleInput ? 'IN' : ''].filter(Boolean).join(' + ') : 'not linked';
  $('screen-badge').textContent = devices?.screen ? '6 coordinates' : consoleLinked ? 'No screen' : 'No optional devices';
  $<HTMLInputElement>('console-input').disabled = !devices?.consoleInput || machine?.status === 'ended' || machine?.status === 'fault';
  $<HTMLButtonElement>('send-input').disabled = $<HTMLInputElement>('console-input').disabled;
  $<HTMLButtonElement>('send-eof').disabled = $<HTMLInputElement>('console-input').disabled;
  $('input-hint').textContent = machine?.status === 'waiting' ? (playIntent ? 'Waiting for a character. Typing resumes the run automatically.' : 'Paused at input. Characters are queued; press Run to continue.') : devices?.consoleInput ? 'Characters are sent immediately. Enter = newline; Backspace = character 8. EOF closes the stream.' : 'This program does not use console input. No input coordinates were added.';
  const context = $<HTMLCanvasElement>('screen').getContext('2d')!;
  const image = context.createImageData(16, 16);
  for (let pixel = 0; pixel < 256; pixel++) {
    for (let channel = 0; channel < 3; channel++) image.data[pixel * 4 + channel] = machine?.pixels[pixel * 3 + channel] ?? 0;
    image.data[pixel * 4 + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  const ledEnabled = $<HTMLInputElement>('enable-led').checked;
  const ledLinked = artifact?.led !== undefined && ledEnabled;
  const ledOn = ledLinked && machine && machine.state[artifact!.led!] !== 0;
  $('led').classList.toggle('on', Boolean(ledOn));
  $('led-text').textContent = !ledEnabled ? 'LED disabled' : ledLinked ? `Result LED: ${ledOn ? 'on' : 'off'} (${machine?.state[artifact!.led!] ?? 0})` : 'LED not linked';
  const end = artifact && machine ? machine.state[artifact.end] : 0;
  $('end-light').classList.toggle('on', Boolean(end)); $('end-text').textContent = `End gate: ${end}`;
}
function renderHistory(): void {
  if (machine && artifact && lastRecordedTick !== machine.tick) {
    const changes = previousState ? stateChanges(previousState, machine.state) : [];
    recentChanges = new Set(changes.map(change => change.index));
    const active = activeMarkers(artifact, machine.state).map(marker => `L${marker.line} ${marker.context}: ${marker.label}`).join(' · ');
    const detail = changes.slice(0, 6).map(change => `${artifact!.registers[change.index]!.name} ${change.from}→${change.to}`).join(', ') + (changes.length > 6 ? ', …' : '');
    history.unshift({ tick: machine.tick, result: artifact.result === undefined ? undefined : machine.state[artifact.result], active, changes: changes.length, detail });
    if (history.length > 24) history.pop();
    previousState = machine.state.slice(); lastRecordedTick = machine.tick;
  }
  $('history-count').textContent = `${history.length} snapshots`;
  $('history').replaceChildren(...history.map(item => {
    const entry = document.createElement('li');
    entry.textContent = `Tick ${item.tick} · ${item.changes} coordinates changed${item.result === undefined ? '' : ` · result ${item.result}`}${item.active ? ` · ${item.active}` : ''}`;
    if (item.detail) { const detail = document.createElement('small'); detail.textContent = item.detail; entry.append(detail); }
    return entry;
  }));
}
function render(): void {
  const matchingPreset = examples.find(example => example.source === source.value);
  $('active-program-name').textContent = matchingPreset?.name ?? 'Custom program';
  $('program-origin').textContent = matchingPreset ? 'Preset' : 'Edited source';
  for (const [id, card] of presetCards) card.setAttribute('aria-current', String(id === matchingPreset?.id));
  workspaceNotice.hidden = !needsCompile || activeTab === 'program' || activeTab === 'inspect';
  $<HTMLButtonElement>('copy-matrix-python').disabled = !artifact || needsCompile;
  $<HTMLButtonElement>('copy-input-vector').disabled = !machine || needsCompile || invalidParameters;
  $('dimensions').textContent = artifact ? `${artifact.rows.length.toLocaleString()} × ${artifact.rows.length.toLocaleString()}` : '—';
  $('nonzero').textContent = artifact ? artifact.rows.reduce((total, row) => total + row.cols.length, 0).toLocaleString() : '—';
  $('contexts').textContent = artifact ? String(artifact.stats.contexts) : '—';
  $('tick').textContent = machine ? machine.tick.toLocaleString() : '0';
  const phase = machine?.phase ?? 'ready';
  document.querySelectorAll<HTMLElement>('[data-phase]').forEach(item => item.classList.toggle('active', item.dataset.phase === phase));
  const phaseButton = $<HTMLButtonElement>('phase-step');
  phaseButton.textContent = phase === 'ready' ? 'Multiply →' : phase === 'multiplied' ? 'Apply ReLU →' : 'Commit tick →';
  const canStep = Boolean(machine && (machine.status === 'ready' || machine.status === 'waiting') && !running && !needsCompile && !invalidParameters);
  phaseButton.disabled = !canStep; $<HTMLButtonElement>('step').disabled = !canStep;
  const lineButton = $<HTMLButtonElement>('step-line');
  lineButton.disabled = !canStep || !artifact?.markers.length;
  lineButton.title = artifact && !artifact.markers.length ? 'This matrix came from a specialized lowering with no per-instruction program counters; step by phase or tick' : 'Run until execution reaches a different source line (L)';
  $('pause-reason').textContent = pauseReason; $('pause-reason').hidden = !pauseReason || running;
  $<HTMLButtonElement>('run').disabled = !machine || machine.status === 'ended' || machine.status === 'fault' || needsCompile || invalidParameters;
  $('run').textContent = running || playIntent ? 'Ⅱ Pause' : '▶ Run';
  $<HTMLButtonElement>('reset').disabled = !machine || needsCompile || invalidParameters;
  const status = invalidParameters ? 'Invalid input' : !machine ? 'Not compiled' : running ? 'Running' : machine.status === 'ended' ? 'Ended' : machine.status === 'fault' ? 'Fault' : machine.status === 'waiting' ? 'Waiting for input' : 'Paused';
  $('status').textContent = status; $('status').className = `status ${machine?.status ?? ''}${running ? ' running' : ''}`;
  $('phase-explanation').textContent = !machine ? 'Compile a program to inspect its matrix.' : phase === 'ready' ? 'The current vector is committed. Multiply computes all rows from this same state; no row sees another row’s new value.' : phase === 'multiplied' ? 'These are exact signed sums, before ReLU. Negative values are visible here. The state and all devices are still unchanged.' : 'ReLU has clipped negative sums to zero. Inspect the candidate, then commit atomically. Only commit advances time and emits output.';
  if (machine?.error && !invalidParameters && displayedFault !== machine.error) showFault();
  const markers = artifact && machine && !needsCompile ? artifact.markers.filter(marker => machine!.state[marker.register] !== 0) : [];
  $('active-source').textContent = markers.length ? `Line${markers.length > 1 ? 's' : ''} ${[...new Set(markers.map(marker => marker.line))].join(', ')}` : 'No active instruction';
  $('active-contexts').replaceChildren(...markers.slice(0, 12).map(marker => {
    const badge = document.createElement('button'); badge.className = 'context-badge'; badge.textContent = `${marker.context} · L${marker.line} · ${marker.label}`;
    badge.title = `Show line ${marker.line} in the source`;
    badge.addEventListener('click', () => revealLine(marker.line, true));
    return badge;
  }));
  $('backend').textContent = machine?.backend.name.includes('WASM') || machine?.backend.name.includes('WebAssembly') ? '● WASM · exact i64' : backend ? '● Exact JS · compile for WASM' : '● Exact JS backend';
  updateGutter(); renderHistory(); renderVector(); renderCalculation(); renderOutputs(); renderBreakpoints(); mathOverview.render(artifact, machine, $<HTMLInputElement>('enable-led').checked, running, recentChanges); if (matrixView) renderMatrix();
}

// Feature tags come from the preset source itself, so they cannot drift from the program.
const presetFeatures: [RegExp, string][] = [
  [/\b(print|putc)\(/, 'console out'], [/\bread\(/, 'console in'], [/\bpixel\(/, 'screen'],
  [/\brec fn\b/, 'recursion'], [/\bparallel\b/, 'parallel'], [/\blet \w+\[/, 'arrays'],
];
const presetTags = (text: string) => presetFeatures.filter(([pattern]) => pattern.test(text)).map(([, tag]) => tag);
const presetCards = new Map<string, HTMLButtonElement>();
for (const example of examples) {
  const item = document.createElement('div'); item.setAttribute('role', 'listitem');
  const card = document.createElement('button'); card.type = 'button'; card.className = 'preset-card'; card.dataset.preset = example.id;
  const [title, size] = example.name.split(' · ');
  card.innerHTML = '<span class="preset-card-heading"><strong class="preset-card-name"></strong><span class="preset-card-current">Loaded</span></span><span class="preset-card-description"></span><span class="preset-card-tags"></span>';
  card.querySelector('.preset-card-name')!.textContent = example.name;
  card.querySelector('.preset-card-description')!.textContent = example.description;
  const tags = card.querySelector('.preset-card-tags')!;
  for (const tag of [...Object.entries(example.inputs).map(([name, value]) => `${name} = ${value.toLocaleString()}`), ...presetTags(example.source)]) {
    const chip = document.createElement('span'); chip.textContent = tag; tags.append(chip);
  }
  card.setAttribute('aria-label', `${title}${size ? `, ${size}` : ''}. ${example.description}`);
  card.addEventListener('click', () => chooseExample(example.id));
  item.append(card); $('preset-gallery').append(item); presetCards.set(example.id, card);
}
$('compile').addEventListener('click', compileFromEditor);
async function copyNumericData(kind: 'matrix' | 'vector'): Promise<void> {
  if (!artifact || !machine || needsCompile || (kind === 'vector' && invalidParameters)) return;
  const feedback = $('copy-feedback');
  try {
    const tick = machine.tick;
    const text = kind === 'matrix' ? matrixPython(artifact) : vectorPython(machine.state);
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(text);
      feedback.textContent = kind === 'matrix' ? `Copied full ${artifact.rows.length} × ${artifact.rows.length} matrix` : `Copied input vector xₜ · tick ${tick}`;
    } catch {
      const field = $<HTMLTextAreaElement>('copy-manual-text'); field.value = text;
      if (!copyDialog.open) copyDialog.showModal();
      field.focus(); field.select();
      feedback.textContent = 'Clipboard unavailable · select and copy the text manually';
    }
  } catch (error) { feedback.textContent = error instanceof Error ? error.message : String(error); }
}
$('copy-matrix-python').addEventListener('click', () => { void copyNumericData('matrix'); });
$('copy-input-vector').addEventListener('click', () => { void copyNumericData('vector'); });
source.addEventListener('input', () => { stop(); needsCompile = true; $('dirty').textContent = 'Source changed · compile to apply'; render(); });
source.addEventListener('scroll', () => { $('line-numbers').scrollTop = source.scrollTop; });
source.addEventListener('keydown', event => {
  if (event.key === 'Tab') {
    event.preventDefault(); const start = source.selectionStart; source.setRangeText('  ', start, source.selectionEnd, 'end'); source.dispatchEvent(new Event('input'));
  }
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); compileFromEditor(); }
  if (event.key === 'F9') { event.preventDefault(); toggleBreakpoint(source.value.slice(0, source.selectionStart).split('\n').length); }
});
$('phase-step').addEventListener('click', () => { stop(); execute(() => machine!.stepPhase()); });
$('step').addEventListener('click', () => { stop(); execute(() => machine!.step()); });
$('reset').addEventListener('click', () => { stop(); execute(() => { machine!.reset(inputValues()); resetHistory(); }); });
$('run').addEventListener('click', () => { if (running || playIntent) { stop(); render(); } else beginPlaying('run'); });
$('step-line').addEventListener('click', () => beginPlaying('line'));
// Debugger keys work anywhere outside text entry, in the tabs that show the transport.
const shortcuts: Record<string, string> = { '.': 'phase-step', t: 'step', l: 'step-line', r: 'run' };
document.addEventListener('keydown', event => {
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
  if ((event.target as HTMLElement).closest?.('input, textarea, select, [contenteditable], dialog') || (activeTab !== 'run' && activeTab !== 'inspect')) return;
  const button = shortcuts[event.key.toLowerCase()];
  if (!button || $<HTMLButtonElement>(button).disabled) return;
  event.preventDefault(); $(button).click();
});
$('line-numbers').addEventListener('click', event => {
  const line = Number((event.target as HTMLElement).closest<HTMLElement>('[data-line]')?.dataset.line);
  if (line) toggleBreakpoint(line);
});
document.addEventListener('visibilitychange', () => {
  // A pending animation frame would wait until the tab is visible again.
  if (running && frame) scheduleFrame();
  if (!document.hidden) render();
});
for (const id of ['filter', 'internals', 'changed']) $(id).addEventListener('input', renderVector);
$('enable-led').addEventListener('change', () => { renderOutputs(); mathOverview.render(artifact, machine, $<HTMLInputElement>('enable-led').checked, running); });
for (const id of ['enable-output', 'enable-input', 'enable-screen']) $(id).addEventListener('change', () => { stop(); needsCompile = true; $('dirty').textContent = 'Devices changed · compile to apply'; render(); });
function changeView(matrix: boolean): void { matrixView = true; if (matrix) document.querySelector<HTMLDetailsElement>('.matrix-overview')!.open = true; for (const [id, selected] of [['vector-tab', !matrix], ['matrix-tab', matrix]] as const) { $(id).classList.toggle('selected', selected); $(id).setAttribute('aria-pressed', String(selected)); } renderMatrix(); }
$('vector-tab').addEventListener('click', () => changeView(false)); $('matrix-tab').addEventListener('click', () => changeView(true));
$('matrix-canvas').addEventListener('click', event => {
  if (!artifact) return;
  const bounds = $('matrix-canvas').getBoundingClientRect(); selectedRow = Math.min(artifact.rows.length - 1, Math.max(0, Math.floor((event.clientY - bounds.top) / bounds.height * artifact.rows.length)));
  const column = Math.min(artifact.rows.length - 1, Math.max(0, Math.floor((event.clientX - bounds.left) / bounds.width * artifact.rows.length)));
  $('matrix-hover').textContent = `Destination row ${selectedRow}: ${artifact.registers[selectedRow]!.name} · source column ${column}: ${artifact.registers[column]!.name}`;
  matrixInspector.inspect(selectedRow, column);
});
function deliverCharacters(text: string, close = false): void {
  if (!machine || needsCompile) return;
  const resume = playIntent;
  try { if (text) machine.enqueueInput(text); if (close) machine.closeInput(); setError(); }
  catch (error) { stop(); setError(error); render(); return; }
  if (resume) beginPlaying(); else render();
}
const consoleInput = $<HTMLInputElement>('console-input');
consoleInput.placeholder = 'Type characters · Enter sends newline';
$('send-input').textContent = 'Enter'; $('send-input').setAttribute('aria-label', 'Send newline');
consoleInput.addEventListener('compositionstart', () => { composingInput = true; });
consoleInput.addEventListener('compositionend', () => { composingInput = false; const value = consoleInput.value; consoleInput.value = ''; deliverCharacters(value); });
consoleInput.addEventListener('input', event => {
  if (composingInput || (event as InputEvent).isComposing) return;
  const value = consoleInput.value; consoleInput.value = ''; deliverCharacters(value);
});
consoleInput.addEventListener('paste', event => {
  event.preventDefault(); deliverCharacters(event.clipboardData?.getData('text/plain') ?? '');
});
consoleInput.addEventListener('keydown', event => {
  if (event.key === 'Backspace' && !composingInput) { event.preventDefault(); deliverCharacters('\b'); }
});
$('console-form').addEventListener('submit', event => { event.preventDefault(); if (!composingInput) deliverCharacters('\n'); });
$('send-eof').addEventListener('click', () => deliverCharacters('', true));

// A ?preset= link opens that program in Run; a plain visit starts at the gallery,
// with parity ready behind it so Program, Run and Inspect are usable immediately.
const requestedPreset = examples.find(example => example.id === new URLSearchParams(location.search).get('preset'));
chooseExample(requestedPreset?.id ?? 'parity');
if (requestedPreset) selectAppTab('run');
else {
  renderParameters({ n: 4 });
  resetParameters();
  selectAppTab('presets');
}
void createWasmBackend().then(result => {
  backend = result;
  $('backend').textContent = '● WASM ready';
  // Do not interrupt a user who already began exploring during loading.
  if (machine?.tick === 0 && machine.phase === 'ready' && !running && !needsCompile && !invalidParameters) compileProgram();
}).catch(error => { $('backend').textContent = '● Exact JS backend'; $('backend').title = `WASM unavailable: ${error instanceof Error ? error.message : String(error)}`; });
