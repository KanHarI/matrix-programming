import type { Artifact } from './core/types';

/** Sparse storage never changes the meaning of an omitted (zero) coefficient. */
export function coefficient(a: Artifact, row: number, column: number): number {
  if (!Number.isInteger(row) || !Number.isInteger(column) || row < 0 || column < 0 || row >= a.rows.length || column >= a.rows.length) throw new Error('Matrix coordinate is out of range');
  const r = a.rows[row];
  return r.cols.reduce((sum, col, i) => sum + (col === column ? r.weights[i] : 0), 0);
}

/** Absolute coefficient overrides, not W-I deltas. Off-diagonal defaults are 0. */
export function logicalRow(a: Artifact, row: number, diagonalDefault: 0 | 1): { column: number; weight: number }[] {
  if (!Number.isInteger(row) || row < 0 || row >= a.rows.length) throw new Error('Matrix coordinate is out of range');
  const weights = new Map<number, number>();
  a.rows[row].cols.forEach((column, i) => weights.set(column, (weights.get(column) ?? 0) + a.rows[row].weights[i]));
  // An absent diagonal coefficient is an explicit zero override in identity mode.
  if (!weights.has(row)) weights.set(row, 0);
  return [...weights].filter(([column, weight]) => weight !== (column === row ? diagonalDefault : 0))
    .sort(([a], [b]) => a - b).map(([column, weight]) => ({ column, weight }));
}

export function matrixCsv(a: Artifact): string {
  const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
  const lines = ['destination_index,source_index,weight,destination_name,source_name'];
  a.rows.forEach((row, dst) => row.cols.forEach((src, i) => {
    lines.push(`${dst},${src},${row.weights[i]},${quote(a.registers[dst].name)},${quote(a.registers[src].name)}`);
  }));
  return lines.join('\n') + '\n';
}

export function matrixJson(a: Artifact): string {
  return JSON.stringify({ format: 'matrix-lab-sparse-v1', shape: [a.rows.length, a.rows.length],
    orientation: 'W[destination row, source column]; omitted coefficients are zero',
    registers: a.registers, rows: a.rows, initial: a.initial, inputs: a.inputs,
    end: a.end, result: a.result, led: a.led, devices: a.devices,
  }, null, 2);
}

/** Render a bounded window, never an N² DOM tree or dense matrix allocation. */
export class MatrixInspector {
  private artifact?: Artifact;
  private startRow = 0;
  private startColumn = 0;
  private selectedRow = 0;
  private selectedColumn = 0;
  private readonly pageSize = 12;
  private readonly rowInput: HTMLInputElement;
  private readonly columnInput: HTMLInputElement;
  private readonly table: HTMLTableElement;
  private readonly selection: HTMLElement;
  private readonly range: HTMLElement;
  private readonly search: HTMLInputElement;
  private readonly matches: HTMLElement;
  private logicalMode = true;
  private readonly logical: HTMLElement;
  private readonly diagonal: HTMLInputElement;
  private readonly termOffsets = new Map<number, number>();

  constructor(private readonly root: HTMLElement, private readonly selectRow: (row: number) => void) {
    root.innerHTML = `
      <div class="matrix-grid-heading"><h3>Matrix W</h3><span>Exact coefficients · read-only</span></div>
      <div class="matrix-view-options" role="group" aria-label="Matrix representation">
        <button id="matrix-view-grid" type="button" aria-pressed="false">Coefficient grid</button>
        <button id="matrix-view-logical" type="button" aria-pressed="true">Logical rows</button>
        <label id="matrix-diagonal-option" hidden><input id="matrix-diagonal-default" type="checkbox" checked>Diagonal default on (1)</label>
      </div>
      <p id="matrix-logical-help" class="matrix-grid-help" hidden></p>
      <p id="matrix-orientation-help" class="matrix-grid-help">Rows write the next state; columns read the current state. Every cell below is an actual signed integer weight, including zeros. Use the overview above or jump to any coordinate.</p>
      <form class="matrix-navigation">
        <label>First row <input id="matrix-row-start" type="number" min="0" step="1" value="0" required></label>
        <label id="matrix-column-label">First column <input id="matrix-column-start" type="number" min="0" step="1" value="0" required></label>
        <button type="submit">Go to block</button>
      </form>
      <div class="matrix-pagination"><button type="button" data-move="up" aria-label="Previous matrix rows">↑ Rows</button><button type="button" data-move="down" aria-label="Next matrix rows">↓ Rows</button><button type="button" data-move="left" aria-label="Previous matrix columns">← Columns</button><button type="button" data-move="right" aria-label="Next matrix columns">→ Columns</button><span id="matrix-range" aria-live="polite"></span></div>
      <label class="matrix-search-label">Find a row or column by register name or index<input id="matrix-register-search" type="search" placeholder="e.g. main.main.n, clock, or 937" autocomplete="off"></label>
      <div id="matrix-register-matches" class="matrix-register-matches"></div>
      <div id="matrix-logical-rows" class="matrix-logical-rows" hidden></div>
      <div class="coefficient-scroll" tabindex="0" aria-label="Scrollable matrix coefficient grid"><table id="coefficient-table"><caption>W — destination rows × source columns (zero-based indices)</caption></table></div>
      <p id="matrix-cell-detail" class="matrix-cell-detail" aria-live="polite">Select a cell to inspect its exact coefficient.</p>
      <div class="matrix-exports"><button id="matrix-export-json" type="button">Download full matrix JSON</button><button id="matrix-export-csv" type="button">Download nonzero CSV</button><span>Exports include every row/column name—not just the visible block. CSV lists nonzero entries; all omitted cells are 0.</span></div>`;
    const get = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
    this.rowInput = get('matrix-row-start'); this.columnInput = get('matrix-column-start');
    this.table = get('coefficient-table'); this.selection = get('matrix-cell-detail'); this.range = get('matrix-range');
    this.search = get('matrix-register-search'); this.matches = get('matrix-register-matches');
    this.logical = get('matrix-logical-rows'); this.diagonal = get('matrix-diagonal-default');
    for (const mode of ['grid', 'logical'] as const) get(`matrix-view-${mode}`).addEventListener('click', () => {
      this.logicalMode = mode === 'logical'; this.render();
    });
    this.diagonal.addEventListener('change', () => { this.termOffsets.clear(); this.render(); });
    root.querySelector('form')!.addEventListener('submit', e => {
      e.preventDefault(); if (!this.artifact) return;
      this.startRow = Number(this.rowInput.value); this.startColumn = Number(this.columnInput.value);
      this.render();
    });
    root.querySelectorAll<HTMLButtonElement>('[data-move]').forEach(button => button.addEventListener('click', () => {
      if (button.dataset.move === 'up') this.startRow -= this.pageSize;
      if (button.dataset.move === 'down') this.startRow += this.pageSize;
      if (button.dataset.move === 'left') this.startColumn -= this.pageSize;
      if (button.dataset.move === 'right') this.startColumn += this.pageSize;
      this.render();
    }));
    this.search.addEventListener('input', () => this.renderSearch());
    get('matrix-export-json').addEventListener('click', () => this.download('json'));
    get('matrix-export-csv').addEventListener('click', () => this.download('csv'));
  }

  setArtifact(artifact?: Artifact): void {
    if (artifact === this.artifact) return;
    this.artifact = artifact; this.startRow = this.startColumn = this.selectedRow = this.selectedColumn = 0;
    this.termOffsets.clear();
    this.search.value = ''; this.matches.replaceChildren(); this.render();
  }

  /** The whole-matrix overview chooses both axes, not only a destination row. */
  inspect(row: number, column: number): void {
    this.selectedRow = row; this.selectedColumn = column;
    this.startRow = Math.floor(row / this.pageSize) * this.pageSize;
    this.startColumn = Math.floor(column / this.pageSize) * this.pageSize;
    if (this.artifact && this.logicalMode) {
      const terms = logicalRow(this.artifact, row, this.diagonal.checked ? 1 : 0);
      const index = terms.findIndex(term => term.column === column);
      this.termOffsets.set(row, index < 0 ? 0 : Math.floor(index / 64) * 64);
    }
    this.render(); this.selectRow(row);
  }

  private render(): void {
    const a = this.artifact, n = a?.rows.length ?? 0;
    this.root.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input,button').forEach(control => { control.disabled = !a; });
    this.root.querySelector('#matrix-view-grid')!.setAttribute('aria-pressed', String(!this.logicalMode));
    this.root.querySelector('#matrix-view-logical')!.setAttribute('aria-pressed', String(this.logicalMode));
    this.root.querySelector<HTMLElement>('.coefficient-scroll')!.hidden = this.logicalMode;
    this.logical.hidden = !this.logicalMode;
    for (const id of ['matrix-diagonal-option', 'matrix-logical-help']) this.root.querySelector<HTMLElement>(`#${id}`)!.hidden = !this.logicalMode;
    this.root.querySelector<HTMLElement>('#matrix-column-label')!.hidden = this.logicalMode;
    this.columnInput.disabled = this.logicalMode || !a;
    for (const move of ['left', 'right']) this.root.querySelector<HTMLElement>(`[data-move="${move}"]`)!.hidden = this.logicalMode;
    this.root.querySelector('#matrix-logical-help')!.textContent =
      `Defaults: diagonal ${this.diagonal.checked ? 1 : 0}, off-diagonal 0. Listed weights replace these defaults; they are not additions. ` +
      (this.diagonal.checked ? 'Self-weights of 1 are omitted; every other diagonal weight, including 0, is explicit. ' : 'Only nonzero weights are listed, including diagonal 1s. ') +
      '{} means this row uses only the defaults. This changes the notation, never W or execution. ReLU still follows W × x.';
    this.root.querySelector('#matrix-orientation-help')!.textContent = this.logicalMode
      ? 'Each destination names a row; its dictionary names source columns and their exact weights. Select a weight to inspect the full row calculation below. Row navigation shows 12 destinations at a time.'
      : 'Rows write the next state; columns read the current state. Every cell below is an actual signed integer weight, including zeros. Use the overview above or jump to any coordinate.';
    this.table.replaceChildren();
    this.logical.replaceChildren();
    if (!a) { this.range.textContent = 'No compiled matrix'; this.selection.textContent = 'Compile a program to inspect its matrix.'; return; }
    const clamp = (x: number) => Math.max(0, Math.min(n - 1, Number.isFinite(x) ? Math.floor(x) : 0));
    this.startRow = clamp(this.startRow); this.startColumn = clamp(this.startColumn);
    this.rowInput.max = this.columnInput.max = String(n - 1);
    this.rowInput.value = String(this.startRow); this.columnInput.value = String(this.startColumn);
    const endRow = Math.min(n, this.startRow + this.pageSize), endCol = Math.min(n, this.startColumn + this.pageSize);
    let digits = 1;
    for (let r = this.startRow; r < endRow; r++) a.rows[r].cols.forEach((col, i) => {
      if (col >= this.startColumn && col < endCol) digits = Math.max(digits, String(a.rows[r].weights[i]).length);
    });
    this.table.style.setProperty('--coefficient-width', `${Math.max(36, digits * 7 + 14)}px`);
    this.range.textContent = this.logicalMode
      ? `Rows ${this.startRow}–${endRow - 1} · overrides across all ${n} source columns · ${n} × ${n} total`
      : `Rows ${this.startRow}–${endRow - 1} · columns ${this.startColumn}–${endCol - 1} · ${n} × ${n} total`;
    for (const [move, disabled] of [['up', this.startRow === 0], ['down', endRow === n], ['left', this.startColumn === 0], ['right', endCol === n]] as const) {
      this.root.querySelector<HTMLButtonElement>(`[data-move="${move}"]`)!.disabled = disabled;
    }
    if (this.logicalMode) { this.renderLogical(endRow); this.renderSelection(); return; }
    const caption = this.table.createCaption(); caption.textContent = 'W — destination rows × source columns (zero-based indices)';
    const header = this.table.createTHead().insertRow();
    const corner = document.createElement('th'); corner.textContent = 'destination ↓ / source →'; header.append(corner);
    for (let col = this.startColumn; col < endCol; col++) {
      const th = document.createElement('th'); th.scope = 'col'; th.title = `[${col}] ${a.registers[col].name}`;
      th.textContent = `[${col}] ${a.registers[col].name}`; header.append(th);
    }
    const body = this.table.createTBody();
    for (let row = this.startRow; row < endRow; row++) {
      const tr = body.insertRow(), th = document.createElement('th'); th.scope = 'row';
      th.textContent = `[${row}] ${a.registers[row].name}`; th.title = th.textContent; tr.append(th);
      const coefficients = new Map<number, number>();
      a.rows[row].cols.forEach((col, i) => coefficients.set(col, (coefficients.get(col) ?? 0) + a.rows[row].weights[i]));
      for (let col = this.startColumn; col < endCol; col++) {
        const weight = coefficients.get(col) ?? 0, cell = tr.insertCell(), button = document.createElement('button');
        button.textContent = String(weight); button.dataset.row = String(row); button.dataset.column = String(col);
        button.className = `matrix-coefficient ${weight < 0 ? 'weight-negative' : weight > 0 ? 'weight-positive' : 'weight-zero'}`;
        button.setAttribute('aria-label', `W[${row}, ${col}] = ${weight}`);
        button.setAttribute('aria-pressed', String(row === this.selectedRow && col === this.selectedColumn));
        button.addEventListener('click', () => {
          this.selectedRow = row; this.selectedColumn = col;
          this.table.querySelectorAll('button[aria-pressed="true"]').forEach(b => b.setAttribute('aria-pressed', 'false'));
          button.setAttribute('aria-pressed', 'true'); this.renderSelection(); this.selectRow(row);
        }); cell.append(button);
      }
    }
    this.renderSelection();
  }

  private renderLogical(endRow: number): void {
    const a = this.artifact!;
    for (let row = this.startRow; row < endRow; row++) {
      const terms = logicalRow(a, row, this.diagonal.checked ? 1 : 0);
      const offset = this.termOffsets.get(row) ?? 0;
      const line = document.createElement('div'); line.className = 'matrix-logical-row'; line.dataset.row = String(row);
      const destination = document.createElement('button'); destination.className = 'logical-destination';
      destination.textContent = `${JSON.stringify(`[${row}] ${a.registers[row].name}`)}:`;
      destination.setAttribute('aria-label', `Inspect destination row ${row}: ${a.registers[row].name}`);
      destination.addEventListener('click', () => this.inspect(row, row));
      line.append(destination, document.createTextNode(' { '));
      if (offset > 0) line.append(document.createTextNode('… , '));
      terms.slice(offset, offset + 64).forEach(({ column, weight }, index) => {
        if (index) line.append(document.createTextNode(', '));
        const term = document.createElement('button');
        term.className = `logical-coefficient ${weight < 0 ? 'weight-negative' : weight > 0 ? 'weight-positive' : 'weight-zero'}`;
        term.textContent = `${JSON.stringify(`[${column}] ${a.registers[column].name}`)}: ${weight}`;
        term.dataset.row = String(row); term.dataset.column = String(column); term.dataset.weight = String(weight);
        term.setAttribute('aria-label', `W[${row}, ${column}] = ${weight}`);
        term.setAttribute('aria-pressed', String(row === this.selectedRow && column === this.selectedColumn));
        term.addEventListener('click', () => this.inspect(row, column)); line.append(term);
      });
      if (offset + 64 < terms.length) line.append(document.createTextNode(', …'));
      line.append(document.createTextNode(' }'));
      if (terms.length > 64) {
        const navigation = document.createElement('div'); navigation.className = 'logical-term-navigation';
        const summary = document.createElement('span');
        summary.textContent = `Partial row: overrides ${offset + 1}–${Math.min(offset + 64, terms.length)} of ${terms.length}. Other overrides are on the remaining pages.`;
        navigation.append(summary);
        for (const [label, next] of [['Previous', offset - 64], ['Next', offset + 64]] as const) {
          const button = document.createElement('button'); button.textContent = `${label} terms`;
          button.setAttribute('aria-label', `${label} terms for row ${row}`);
          button.disabled = next < 0 || next >= terms.length;
          button.addEventListener('click', () => { this.termOffsets.set(row, next); this.render(); }); navigation.append(button);
        }
        line.append(navigation);
      }
      this.logical.append(line);
    }
  }

  private renderSelection(): void {
    const a = this.artifact; if (!a) return;
    this.selection.textContent = `W[${this.selectedRow}, ${this.selectedColumn}] = ${coefficient(a, this.selectedRow, this.selectedColumn)} · destination: ${a.registers[this.selectedRow].name} · source: ${a.registers[this.selectedColumn].name}. The full destination-row calculation is shown below.`;
  }

  private renderSearch(): void {
    this.matches.replaceChildren(); const a = this.artifact, query = this.search.value.trim().toLowerCase();
    if (!a || !query) return;
    let count = 0;
    for (let i = 0; i < a.registers.length; i++) {
      if (String(i) !== query && !a.registers[i].name.toLowerCase().includes(query)) continue;
      count++; if (count > 20) continue;
      const item = document.createElement('div'), label = document.createElement('span'); label.textContent = `[${i}] ${a.registers[i].name}`; item.append(label);
      for (const axis of ['row', 'column'] as const) {
        const button = document.createElement('button'); button.textContent = `Go to ${axis}`;
        button.addEventListener('click', () => { this.inspect(axis === 'row' ? i : this.selectedRow, axis === 'column' ? i : this.selectedColumn); }); item.append(button);
      }
      this.matches.append(item);
    }
    const summary = document.createElement('p'); summary.textContent = count ? `${Math.min(count, 20)} of ${count} matches${count > 20 ? ' — refine your search to see more' : ''}` : 'No matching coordinates'; this.matches.append(summary);
  }

  private download(format: 'json' | 'csv'): void {
    const a = this.artifact; if (!a) return;
    const url = URL.createObjectURL(new Blob([format === 'json' ? matrixJson(a) : matrixCsv(a)], { type: format === 'json' ? 'application/json' : 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `matrix-${a.rows.length}x${a.rows.length}.${format}`;
    anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
