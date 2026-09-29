import type { Artifact } from './core/types';

interface LineEntry { element: HTMLDetailsElement; toggle: HTMLButtonElement; markers: { index: number; element: HTMLButtonElement }[] }
export interface InstructionListHandlers {
  toggleBreakpoint(line: number): void;
  inspectRegister(register: number): void;
  revealLine(line: number): void;
}

/**
 * Maps source lines to the program-counter coordinates compiled from them. This is the
 * disassembly view: each marker is a control-state coordinate that is nonzero while its
 * instruction executes. Breakpoints are per line, so the list groups instructions by line.
 */
export class InstructionList {
  private artifact?: Artifact;
  private lines = new Map<number, LineEntry>();
  private readonly list: HTMLElement;
  private readonly summary: HTMLElement;

  constructor(private readonly root: HTMLElement, private readonly handlers: InstructionListHandlers) {
    root.className = 'panel instructions-panel';
    root.setAttribute('aria-labelledby', 'instructions-heading');
    root.innerHTML = `
      <div class="panel-heading"><h2 id="instructions-heading">Compiled instructions</h2><span id="instruction-count" class="device-badge"></span></div>
      <p class="instructions-note" id="instruction-summary"></p>
      <div id="instruction-list" class="instruction-list"></div>`;
    this.list = root.querySelector('#instruction-list')!;
    this.summary = root.querySelector('#instruction-summary')!;
  }

  render(artifact: Artifact | undefined, state: ArrayLike<number> | undefined, breakpoints: ReadonlySet<number>): void {
    if (artifact !== this.artifact) this.build(artifact);
    if (!artifact) return;
    for (const [line, entry] of this.lines) {
      let active = false;
      for (const { index, element } of entry.markers) {
        const on = Boolean(state && state[artifact.markers[index]!.register] !== 0);
        active ||= on;
        if (element.classList.contains('active') !== on) element.classList.toggle('active', on);
      }
      if (entry.element.classList.contains('active') !== active) entry.element.classList.toggle('active', active);
      const set = breakpoints.has(line);
      if (entry.toggle.getAttribute('aria-pressed') !== String(set)) {
        entry.toggle.setAttribute('aria-pressed', String(set));
        entry.toggle.title = `${set ? 'Remove' : 'Add'} breakpoint on line ${line}`;
        entry.toggle.setAttribute('aria-label', entry.toggle.title);
      }
    }
  }

  /** Scroll the list (never the page) to a line, for example after a breakpoint or line step. */
  focusLine(line: number): void {
    const entry = this.lines.get(line);
    if (!entry) return;
    const top = entry.element.offsetTop; // The list is positioned, so this is relative to it.
    if (top < this.list.scrollTop || top + entry.element.offsetHeight > this.list.scrollTop + this.list.clientHeight) this.list.scrollTop = Math.max(0, top - this.list.clientHeight / 3);
  }

  private build(artifact: Artifact | undefined): void {
    this.artifact = artifact;
    this.lines.clear();
    this.list.replaceChildren();
    const count = this.root.querySelector('#instruction-count')!;
    if (!artifact) { count.textContent = ''; this.summary.textContent = 'Compile a program to list its instructions.'; return; }
    count.textContent = `${artifact.markers.length} pc · ${new Set(artifact.markers.map(marker => marker.line)).size} lines`;
    if (!artifact.markers.length) {
      this.summary.textContent = 'This matrix came from a specialized lowering (a fused loop or straight-line circuit), so no coordinate acts as a per-instruction program counter. Step line and breakpoints are unavailable; step by phase or tick instead.';
      return;
    }
    this.summary.textContent = 'Each instruction owns a program-counter coordinate that is 1 while it executes. Click a dot to set a breakpoint on that line; open a line to inspect its program-counter rows.';
    const source = artifact.source.split('\n');
    const byLine = new Map<number, number[]>();
    artifact.markers.forEach((marker, index) => byLine.set(marker.line, [...(byLine.get(marker.line) ?? []), index]));
    for (const line of [...byLine.keys()].sort((a, b) => a - b)) {
      const indices = byLine.get(line)!;
      const element = document.createElement('details');
      element.className = 'instruction-line';
      element.dataset.line = String(line);
      const summary = document.createElement('summary');
      const toggle = document.createElement('button');
      toggle.type = 'button'; toggle.className = 'breakpoint-toggle'; toggle.setAttribute('aria-pressed', 'false');
      toggle.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); this.handlers.toggleBreakpoint(line); });
      const number = document.createElement('span'); number.className = 'instruction-line-number'; number.textContent = `L${line}`;
      const code = document.createElement('code'); code.textContent = source[line - 1]?.trim() || '(line not in source)';
      const count = document.createElement('span'); count.className = 'instruction-line-count';
      const contexts = new Set(indices.map(index => artifact.markers[index]!.context));
      count.textContent = `${indices.length} pc${contexts.size > 1 ? ` · ${contexts.size} contexts` : ''}`;
      summary.append(toggle, number, code, count);
      summary.addEventListener('click', () => this.handlers.revealLine(line));
      const markers = indices.map(index => {
        const marker = artifact.markers[index]!;
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'instruction-marker';
        button.innerHTML = '<span class="instruction-register"></span><span class="instruction-label"></span><span class="instruction-context"></span>';
        button.querySelector('.instruction-register')!.textContent = `#${marker.register}`;
        button.querySelector('.instruction-label')!.textContent = marker.label;
        button.querySelector('.instruction-context')!.textContent = marker.context;
        button.title = `Inspect program-counter coordinate ${marker.register}: ${artifact.registers[marker.register]!.name}`;
        button.addEventListener('click', () => this.handlers.inspectRegister(marker.register));
        return { index, element: button };
      });
      const body = document.createElement('div'); body.className = 'instruction-markers';
      body.append(...markers.map(marker => marker.element));
      element.append(summary, body);
      this.list.append(element);
      this.lines.set(line, { element, toggle, markers });
    }
  }
}
