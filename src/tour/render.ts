/** Small DOM helpers for the tour's mathematical objects. */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

/** Signed integers with a true minus sign, as in the lab's math view. */
export const num = (value: number | bigint | undefined) => value === undefined ? '—' : String(value).replace('-', '−');

export function symbol(name: string, subscript?: string): HTMLElement {
  const label = el('div', 't-symbol');
  label.append(el('i', '', name));
  if (subscript) label.append(el('sub', '', subscript));
  return label;
}

export interface Grid { root: HTMLElement; cells: HTMLElement[][]; rows: HTMLElement[] }
/** A bracketed matrix; `cells[r][c]` are addressable for highlighting. */
export function matrix(values: number[][], caption?: string, rowLabels?: string[]): Grid {
  const root = el('figure', 't-object');
  const body = el('div', 't-vector-body');
  if (rowLabels) {
    const labels = el('div', 't-vector-labels');
    for (const text of rowLabels) labels.append(el('span', 't-vector-label', text));
    body.append(labels);
  }
  const bracket = el('div', 't-bracket');
  const grid = el('div', 't-grid');
  grid.style.gridTemplateColumns = `repeat(${values[0]?.length ?? 1}, auto)`;
  const cells: HTMLElement[][] = [], rows: HTMLElement[] = [];
  values.forEach((row, r) => {
    const band = el('span', 't-row-band'); band.style.gridRow = String(r + 1); rows.push(band); grid.append(band);
    cells.push(row.map((value, c) => {
      const cell = el('span', `t-cell${value === 0 ? ' t-zero' : ''}${value < 0 ? ' t-negative' : ''}`, num(value));
      cell.style.gridRow = String(r + 1); cell.style.gridColumn = String(c + 1);
      grid.append(cell);
      return cell;
    }));
  });
  bracket.append(grid);
  body.append(bracket);
  root.append(body);
  if (caption) root.append(el('figcaption', '', caption));
  return { root, cells, rows };
}

export interface Column { root: HTMLElement; cells: HTMLElement[]; labels: HTMLElement[] }
/** A bracketed column vector with optional labels beside each entry. */
export function vector(values: (number | bigint | undefined)[], options: { labels?: string[]; caption?: string; side?: 'left' | 'right' } = {}): Column {
  const root = el('figure', `t-object t-vector${options.labels ? ` t-labeled-${options.side ?? 'left'}` : ''}`);
  const body = el('div', 't-vector-body');
  const labelColumn = el('div', 't-vector-labels');
  const bracket = el('div', 't-bracket');
  const column = el('div', 't-grid');
  const cells = values.map(value => { const cell = el('span', 't-cell', num(value)); column.append(cell); return cell; });
  const labels = (options.labels ?? []).map(text => { const label = el('span', 't-vector-label', text); labelColumn.append(label); return label; });
  bracket.append(column);
  if (options.labels && options.side === 'right') body.append(bracket, labelColumn);
  else if (options.labels) body.append(labelColumn, bracket);
  else body.append(bracket);
  root.append(body);
  if (options.caption) root.append(el('figcaption', '', options.caption));
  return { root, cells, labels };
}

/** Update a vector's entries, marking negatives and optionally flashing changed values. */
export function fill(column: Column, values: (number | bigint | undefined)[], flash = true): void {
  column.cells.forEach((cell, index) => {
    const text = num(values[index]);
    if (cell.textContent !== text && flash) { cell.classList.remove('t-flash'); void cell.offsetWidth; cell.classList.add('t-flash'); }
    cell.textContent = text;
    const value = values[index];
    cell.classList.toggle('t-negative', value !== undefined && value < 0);
    cell.classList.toggle('t-pending', value === undefined);
  });
}

/** A source listing; `firstLine` keeps real line numbers when leading lines are omitted. */
export function code(source: string, firstLine = 1): { root: HTMLElement; lines: HTMLElement[] } {
  const root = el('pre', 't-code');
  const lines = source.split('\n').map((text, index) => {
    const line = el('span', `t-code-line${/^\s*\/\//.test(text) ? ' t-comment' : ''}`);
    line.append(el('span', 't-line-number', String(index + firstLine)), el('span', 't-line-text', text || ' '));
    root.append(line);
    return line;
  });
  return { root, lines };
}

export class Cancelled extends Error {}
const motionScale = () => matchMedia('(prefers-reduced-motion: reduce)').matches ? 1.6 : 1;
/** Wait inside a scene's animation; rejects when the scene is left. */
export function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Cancelled()); return; }
    const id = window.setTimeout(resolve, ms * motionScale());
    signal.addEventListener('abort', () => { clearTimeout(id); reject(new Cancelled()); }, { once: true });
  });
}
/** Run a scene timeline until it finishes or the viewer moves on. */
export function play(timeline: () => Promise<void>): void {
  timeline().catch(error => { if (!(error instanceof Cancelled)) throw error; });
}

/** Put a math symbol such as W or xₜ above a bracketed object. */
export function titled<T extends { root: HTMLElement }>(object: T, name: string, subscript?: string): T {
  object.root.prepend(symbol(name, subscript));
  return object;
}
export const operator = (text: string) => el('span', 't-operator', text);
export function reluArrow(): HTMLElement {
  const arrow = el('span', 't-operator t-relu-arrow');
  arrow.append(el('small', '', 'ReLU'), el('span', '', '⟶'));
  return arrow;
}
