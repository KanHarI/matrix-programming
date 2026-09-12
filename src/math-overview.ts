import './math-overview.css';
import type { Artifact } from './core/types';
import type { Machine } from './runtime';

type VectorKind = 'current' | 'raw' | 'candidate';
interface VectorCell { index: number; element: HTMLButtonElement }
interface RoleCell extends VectorCell { coordinateLabel?: string; inputHighlight?: boolean }
interface GateBadge { element: HTMLButtonElement; value: HTMLElement; status: HTMLElement }
interface StatusIndicator { element: HTMLElement; value: HTMLElement; note: HTMLElement }

/** A compact mathematical view; the detailed inspector remains the source of all rows. */
export class MathOverview {
  private artifact?: Artifact;
  private vectorCells: Record<VectorKind, VectorCell[]> = { current: [], raw: [], candidate: [] };
  private phase!: HTMLElement;
  private help!: HTMLElement;
  private rawCaption!: HTMLElement;
  private candidateCaption!: HTMLElement;
  private scroll!: HTMLElement;
  private scrollHint!: HTMLElement;
  private roleCells: RoleCell[] = [];
  private gateBadges: Partial<Record<'led' | 'end', GateBadge>> = {};
  private inputNames = new Map<number, string[]>();
  private inputBadges: { index: number; name: string; element: HTMLButtonElement; value: HTMLElement }[] = [];
  private indicators!: Record<'running' | 'output', StatusIndicator>;

  constructor(private readonly root: HTMLElement, private readonly onSelectRow: (index: number) => void) {
    root.classList.add('math-overview');
    root.setAttribute('aria-label', 'Mathematical matrix and vector overview');
  }

  render(artifact?: Artifact, machine?: Machine, ledEnabled = true, running = false): void {
    if (!artifact || !machine) {
      this.artifact = undefined;
      this.root.innerHTML = '<p class="math-empty">Compile a program to see its matrix and state vectors.</p>';
      return;
    }
    if (artifact !== this.artifact) this.build(artifact);
    this.scrollHint.hidden = this.scroll.scrollWidth <= this.scroll.clientWidth;
    this.phase.textContent = `Tick ${machine.tick.toLocaleString()} · ${machine.phase === 'ready' ? 'current state' : machine.phase === 'multiplied' ? 'before ReLU' : 'after ReLU'}`;
    this.rawCaption.textContent = machine.raw ? 'Exact signed sums' : 'Awaiting Multiply';
    this.candidateCaption.textContent = machine.candidate ? 'Candidate · not yet committed' : 'Awaiting ReLU';
    this.help.textContent = machine.phase === 'ready'
      ? 'Multiply fills z. Apply ReLU fills the candidate. Commit replaces x; previews never change it.'
      : machine.phase === 'multiplied'
        ? 'Negative sums are visible in z. Apply ReLU next: each negative value becomes zero.'
        : 'The candidate is max(0, z), coordinate by coordinate. Commit advances the whole vector together.';
    for (const kind of ['current', 'raw', 'candidate'] as const) {
      const vector = kind === 'current' ? machine.state : kind === 'raw' ? machine.raw : machine.candidate;
      for (const { index, element } of this.vectorCells[kind]) {
        const value = vector?.[index];
        const text = value === undefined ? '—' : this.number(value);
        if (element.textContent !== text) element.textContent = text;
        element.classList.toggle('math-pending', value === undefined);
        element.classList.toggle('math-negative', value !== undefined && value < 0);
        element.classList.toggle('math-clamped', kind === 'candidate' && value !== undefined && Boolean(machine.raw && machine.raw[index]! < 0n));
        element.classList.toggle('math-overflow', kind === 'candidate' && value !== undefined && value > BigInt(artifact.registers[index]!.bound));
        const label = `${kind === 'current' ? 'Current vector' : kind === 'raw' ? 'Before ReLU' : 'After ReLU'}, coordinate ${index}, ${artifact.registers[index]!.name}: ${text}`;
        element.setAttribute('aria-label', label);
        element.title = `${label}. Click to inspect this row.`;
      }
    }
    for (const { index, element, coordinateLabel, inputHighlight } of this.roleCells) {
      const led = ledEnabled && index === artifact.led;
      const end = index === artifact.end;
      const inputs = this.inputNames.get(index);
      element.classList.toggle('math-input-coordinate', Boolean(inputs) && Boolean(inputHighlight));
      element.classList.toggle('math-led-coordinate', led);
      element.classList.toggle('math-end-coordinate', end);
      element.dataset.gates = [led ? 'led' : '', end ? 'end' : ''].filter(Boolean).join(' ');
      const roles = [inputs ? `Initial input coordinate for ${inputs.join(', ')}; its value may evolve during execution` : '', led ? 'LED indicator coordinate' : '', end ? 'End gate coordinate' : ''].filter(Boolean);
      if (roles.length) element.setAttribute('aria-description', roles.join('; '));
      else element.removeAttribute('aria-description');
      if (coordinateLabel !== undefined) element.textContent = `${coordinateLabel}${inputs ? ` · INPUT ${inputs.join(', ')}` : ''}${led ? ' · LED' : ''}${end ? ' · END' : ''}`;
    }
    for (const badge of this.inputBadges) {
      const value = machine.state[badge.index]!;
      badge.value.textContent = `xₜ[${badge.index}] = ${value}`;
      badge.element.setAttribute('aria-label', `Input ${badge.name}; initial input coordinate ${badge.index}, current committed value ${value}. This coordinate may evolve during execution. Inspect coordinate.`);
    }
    for (const kind of ['led', 'end'] as const) {
      const badge = this.gateBadges[kind];
      if (!badge) continue;
      const index = kind === 'end' ? artifact.end : artifact.led!;
      const value = machine.state[index]!;
      const disabled = kind === 'led' && !ledEnabled;
      const active = !disabled && value !== 0;
      badge.value.textContent = `xₜ[${index}] = ${value}`;
      badge.status.textContent = disabled ? 'disabled' : kind === 'end' ? active ? 'ended' : 'waiting' : active ? 'on' : 'off';
      badge.element.classList.toggle('math-gate-active', active);
      badge.element.classList.toggle('math-gate-disabled', disabled);
      badge.element.dataset.active = String(active);
      badge.element.setAttribute('aria-label', `${kind.toUpperCase()} ${badge.status.textContent}; committed coordinate ${index}, ${artifact.registers[index]!.name}, value ${value}. Inspect coordinate.`);
    }
    const activity = this.indicators.running;
    const isRunning = running && machine.status === 'ready';
    activity.element.dataset.active = String(isRunning);
    activity.value.textContent = machine.status === 'ended' ? 'Ended' : machine.status === 'fault' ? 'Fault' : machine.status === 'waiting' ? 'Waiting for input' : isRunning ? 'Running' : 'Paused';
    activity.note.textContent = `Tick ${machine.tick.toLocaleString()} · ${machine.status === 'ended' ? 'Execution complete' : machine.status === 'fault' ? 'Execution stopped' : 'Committed updates'}`;
    const output = this.indicators.output;
    const linked = ledEnabled && artifact.led !== undefined;
    const value = linked ? machine.state[artifact.led!]! : undefined;
    const final = linked && machine.status === 'ended';
    output.element.dataset.active = String(linked && value !== 0);
    output.element.dataset.final = String(final);
    output.value.textContent = linked ? `${value} · ${value !== 0 ? 'ON' : 'OFF'}` : '—';
    output.note.textContent = !ledEnabled ? 'Result LED disabled' : !linked ? 'No result LED linked' : final ? 'Final output · execution ended' : machine.status === 'fault' ? 'Stopped on fault · not a final result' : 'Current LED · not a final result';
  }

  private number(value: number | bigint): string { return String(value).replace('-', '−'); }

  private element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
    const element = document.createElement(tag);
    element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  private label(symbol: string, subscript?: string): HTMLElement {
    const label = this.element('div', 'math-symbol');
    label.append(this.element('i', '', symbol));
    if (subscript) label.append(this.element('sub', '', subscript));
    return label;
  }

  private bracket(columns: number, description: string): HTMLDivElement {
    const bracket = this.element('div', 'math-bracket');
    bracket.setAttribute('role', 'group');
    bracket.setAttribute('aria-label', description);
    const grid = this.element('div', 'math-entries');
    grid.style.gridTemplateColumns = `repeat(${columns}, minmax(2ch, max-content))`;
    bracket.append(grid);
    return bracket;
  }

  private valueButton(row: number, value: string, title: string, inputHighlight = false): HTMLButtonElement {
    const button = this.element('button', 'math-value', value);
    button.type = 'button';
    button.title = title;
    button.dataset.row = String(row);
    this.roleCells.push({ index: row, element: button, inputHighlight });
    button.addEventListener('click', () => this.onSelectRow(row));
    return button;
  }

  private build(artifact: Artifact): void {
    this.artifact = artifact;
    this.vectorCells = { current: [], raw: [], candidate: [] };
    this.roleCells = [];
    this.gateBadges = {};
    this.inputBadges = [];
    this.inputNames = new Map();
    for (const [name, index] of Object.entries(artifact.inputs)) {
      const names = this.inputNames.get(index) ?? [];
      names.push(name); this.inputNames.set(index, names);
    }
    this.root.replaceChildren();
    const n = artifact.rows.length;
    const count = Math.min(n, 8);
    const excerpt = n > count;
    const hasInput = Boolean(artifact.devices.consoleInput);
    const heading = this.element('div', 'math-heading');
    heading.append(this.element('h2', '', 'The matrix step'));
    this.phase = this.element('span', 'math-phase');
    heading.append(this.phase);
    this.root.append(heading);

    const formula = this.element('div', 'math-formula');
    formula.setAttribute('aria-label', hasInput ? 'z equals W times x plus B times u. The next state equals ReLU of z.' : 'z equals W times x. The next state equals ReLU of z.');
    formula.innerHTML = `<i>z</i> = <i>W</i><i>x</i><sub>t</sub>${hasInput ? ' + <i>B</i><i>u</i><sub>t</sub>' : ''}<span class="math-formula-gap"></span><i>x</i><sub>t+1</sub> = <span class="math-relu">ReLU</span>(<i>z</i>)`;
    this.root.append(formula);

    const gates = this.element('div', 'math-gates');
    gates.setAttribute('aria-label', 'Input coordinates and output gates, using committed state only');
    for (const [name, index] of Object.entries(artifact.inputs)) {
      const badge = this.element('button', 'math-gate-badge math-input-badge');
      badge.type = 'button';
      badge.dataset.input = name;
      badge.dataset.row = String(index);
      badge.title = `${name} initializes coordinate ${index}: ${artifact.registers[index]!.name}. The displayed value is committed xₜ and may change during execution. Click to inspect.`;
      const value = this.element('span', 'math-gate-value');
      badge.append(this.element('span', 'math-gate-name', `INPUT ${name}`), value);
      badge.addEventListener('click', () => this.onSelectRow(index));
      gates.append(badge);
      this.inputBadges.push({ index, name, element: badge, value });
    }
    for (const kind of ['led', 'end'] as const) {
      const index = kind === 'end' ? artifact.end : artifact.led;
      if (index === undefined) continue;
      const badge = this.element('button', `math-gate-badge math-${kind}-badge`);
      badge.type = 'button';
      badge.dataset.gate = kind;
      badge.dataset.row = String(index);
      badge.title = `${kind.toUpperCase()} observes committed ${artifact.registers[index]!.name}. Preview values do not activate it. Click to inspect.`;
      const dot = this.element('span', 'math-gate-dot');
      dot.setAttribute('aria-hidden', 'true');
      const value = this.element('span', 'math-gate-value');
      const status = this.element('strong', 'math-gate-status');
      badge.append(dot, this.element('span', 'math-gate-name', kind.toUpperCase()), value, status);
      badge.addEventListener('click', () => this.onSelectRow(index));
      gates.append(badge);
      this.gateBadges[kind] = { element: badge, value, status };
    }
    gates.append(this.element('span', 'math-gate-note', 'Status reads committed xₜ, never the preview.'));
    this.root.append(gates);

    const scroll = this.element('div', 'math-scroll');
    this.scroll = scroll;
    scroll.tabIndex = 0;
    scroll.setAttribute('role', 'region');
    scroll.setAttribute('aria-label', 'Numeric matrix and vector values; scroll horizontally if needed');
    const objects = this.element('div', `math-objects${excerpt ? ' math-excerpts' : ''}`);
    const matrix = this.element('figure', 'math-object math-weight-matrix');
    matrix.append(this.label('W'));
    const weights = this.bracket(count + Number(excerpt), `${excerpt ? 'Top-left excerpt of' : 'Complete'} ${n} by ${n} weight matrix`);
    const grid = weights.firstElementChild!;
    for (let row = 0; row < count; row++) {
      const sparse = artifact.rows[row]!;
      const coefficients = new Map(sparse.cols.map((column, index) => [column, sparse.weights[index]!]));
      for (let column = 0; column < count; column++) {
        const value = coefficients.get(column) ?? 0;
        const label = `W[${row},${column}] = ${value}; destination ${artifact.registers[row]!.name}; source ${artifact.registers[column]!.name}`;
        const cell = this.valueButton(row, this.number(value), `${label}. Click to inspect destination row.`);
        cell.dataset.column = String(column);
        cell.classList.toggle('math-zero', value === 0);
        cell.classList.toggle('math-negative', value < 0);
        cell.setAttribute('aria-label', label);
        grid.append(cell);
      }
      if (excerpt) grid.append(this.element('span', 'math-ellipsis', '⋯'));
    }
    if (excerpt) for (let column = 0; column <= count; column++) grid.append(this.element('span', 'math-ellipsis', column === count ? '⋱' : '⋮'));
    matrix.append(weights);
    matrix.append(this.element('figcaption', '', excerpt ? `Rows & columns 0–7 · ${n.toLocaleString()} × ${n.toLocaleString()} total` : `${n} × ${n} · every weight shown`));
    objects.append(matrix);
    if (!excerpt) objects.append(this.element('span', 'math-operation', '×'));

    for (const kind of ['current', 'raw', 'candidate'] as const) {
      const object = this.element('figure', `math-object math-vector math-${kind}-vector`);
      object.append(this.label(kind === 'raw' ? 'z' : 'x', kind === 'current' ? 't' : kind === 'candidate' ? 't+1' : undefined));
      const bracket = this.bracket(1, `${kind === 'current' ? 'Current' : kind === 'raw' ? 'Before ReLU' : 'After ReLU'} vector${excerpt ? ', first 8 coordinates' : ', complete'}`);
      const values = bracket.firstElementChild!;
      for (let index = 0; index < count; index++) {
        const cell = this.valueButton(index, '—', artifact.registers[index]!.name, kind === 'current');
        values.append(cell);
        this.vectorCells[kind].push({ index, element: cell });
      }
      if (excerpt) values.append(this.element('span', 'math-ellipsis', '⋮'));
      object.append(bracket);
      const caption = this.element('figcaption', '', kind === 'current' ? 'Committed state' : '');
      if (kind === 'raw') this.rawCaption = caption;
      if (kind === 'candidate') this.candidateCaption = caption;
      object.append(caption);
      if (excerpt) object.append(this.element('small', 'math-window-label', `Coordinates 0–7 of ${n.toLocaleString()}`));
      objects.append(object);
      if (!excerpt && kind === 'current') {
        objects.append(this.element('span', hasInput ? 'math-operation math-input-operation' : 'math-operation', hasInput ? '+ B u =' : '='));
      }
      if (!excerpt && kind === 'raw') {
        const operation = this.element('span', 'math-operation math-relu-operation');
        operation.append(this.element('small', '', 'ReLU'), this.element('span', '', '⟶'));
        objects.append(operation);
      }
    }
    scroll.append(objects);
    const stage = this.element('div', 'math-stage-layout');
    const statusPanel = this.element('aside', 'math-status-panel');
    statusPanel.setAttribute('aria-label', 'Execution and output indicators');
    this.indicators = {} as Record<'running' | 'output', StatusIndicator>;
    for (const kind of ['running', 'output'] as const) {
      const indicator = this.element('section', `math-indicator math-${kind}-indicator`);
      indicator.dataset.indicator = kind;
      indicator.setAttribute('aria-label', kind === 'running' ? 'Running indicator' : 'Output indicator');
      const heading = this.element('div', 'math-indicator-heading');
      const dot = this.element('span', 'math-indicator-dot'); dot.setAttribute('aria-hidden', 'true');
      heading.append(dot, this.element('span', '', kind === 'running' ? 'Running' : 'Output'));
      const value = this.element('strong', 'math-indicator-value');
      const note = this.element('span', 'math-indicator-note');
      indicator.append(heading, value, note);
      statusPanel.append(indicator);
      this.indicators[kind] = { element: indicator, value, note };
    }
    stage.append(scroll, statusPanel);
    this.root.append(stage);
    this.scrollHint = this.element('p', 'math-scroll-hint', 'Scroll horizontally to see all four objects →');
    this.root.append(this.scrollHint);

    if (excerpt) this.root.append(this.element('p', 'math-excerpt-note', 'Excerpt only: z uses every column of the full matrix, including coordinates not shown. The displayed matrix block alone does not produce the displayed z values. Use the detailed inspector below for any row or column.'));
    if (hasInput) this.root.append(this.element('p', 'math-input-note', 'B · u adds the reserved console input packet to its fixed latch coordinates. It is consumed only on commit.'));

    const order = this.element('div', 'math-coordinate-order');
    order.append(this.element('span', 'math-order-label', 'Coordinate order'));
    for (let index = 0; index < count; index++) {
      const name = artifact.registers[index]!.name;
      const coordinate = this.element('button', 'math-coordinate', `${index}: ${name}`);
      coordinate.type = 'button';
      coordinate.title = `Inspect coordinate ${index}: ${name}`;
      this.roleCells.push({ index, element: coordinate, coordinateLabel: `${index}: ${name}` });
      coordinate.addEventListener('click', () => this.onSelectRow(index));
      order.append(coordinate);
    }
    if (excerpt) order.append(this.element('span', 'math-order-remaining', `… ${n - count} more`));
    this.root.append(order);
    this.help = this.element('p', 'math-help');
    this.root.append(this.help);
  }
}
