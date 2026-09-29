import { logicalRow } from '../matrix-inspector';
import { fibonacciRun, fibonacciSource, overflowFault, overflowSource, parityHistory, parityRun, shortName } from './data';
import { code, el, num, play, wait } from './render';
import { appFrame, highlight, layer, type Scene } from './scenes';

/** Inspect, beat by beat: a schematic of the tab filled with real compiled data. */
export function inspectScene(): Scene {
  const root = layer('inspect');
  const frame = appFrame(root);
  const { content, point, selectTab } = frame;
  const run = parityRun(4);
  const artifact = run.artifact;
  const update = run.updates[0]!;
  const name = (index: number) => shortName(artifact, index);
  const panel = (title: string, className = '') => { const element = el('div', `t-app-panel ${className}`); element.append(el('small', 't-app-panel-title', title)); return element; };
  const logicalLines = (diagonal: 0 | 1) => artifact.rows.map((_, row) => {
    const terms = logicalRow(artifact, row, diagonal).map(term => `"[${term.column}] ${name(term.column)}": ${num(term.weight)}`).join(', ');
    return el('div', 't-app-row', `"[${row}] ${name(row)}": { ${terms} }`);
  });
  /** The row calculation card, exactly as the lab computes it after Multiply. */
  const rowCard = (row: number) => {
    const card = el('div', 't-app-calc');
    const register = artifact.registers[row]!;
    const chips = el('div', 't-app-chips');
    for (const text of [register.kind, `context ${register.context}`, `from line ${register.line}`]) chips.append(el('span', '', text));
    card.append(el('small', '', 'ROW CALCULATION'), el('strong', '', `[${row}] ${name(row)}`), chips);
    const terms = artifact.rows[row]!.cols.map((column, index) => {
      const weight = artifact.rows[row]!.weights[index]!;
      const term = el('div', `t-app-term${weight < 0 ? ' t-negative' : ''}`);
      term.append(el('span', '', `${num(weight)} × ${name(column)}`), el('b', '', `${num(weight)} × ${update.x[column]} = ${num(weight * update.x[column]!)}`));
      card.append(term); return { term, column };
    });
    const z = update.z[row]!;
    card.append(el('span', 't-app-result', `Sum = ${num(z)} → ReLU = max(0, ${num(z)}) = ${num(update.y[row])}${z < 0n ? ' · negative value is clipped' : ''}`));
    return { card, terms };
  };

  const beats: Record<string, (signal: AbortSignal) => Promise<void>> = {
    async layout(signal) {
      const toolbar = el('div', 't-app-toolbar t-app-pinned');
      toolbar.append(el('span', 't-app-tick', 'Execution · 6 × 6'), ...['Multiply →', 'Full tick', 'Step line', '▶ Run'].map((label, index) => el('span', `t-app-button${index ? '' : ' t-primary'}`, label)));
      const matrix = panel('Matrix W'); matrix.append(...logicalLines(1).slice(0, 3));
      const state = panel('State vector x');
      state.append(...[0, 1, 2].map(row => el('div', 't-app-mini-row', `${row}  ${name(row)} = ${update.x[row]}`)));
      const calc = panel('Row calculation'); calc.append(el('code', '', `[0] ${name(0)}: 1 × 4 − 2 × 1 = 2`));
      const instructions = panel('Compiled instructions'); instructions.append(el('code', '', 'L6  while (remaining >= 2) {'));
      const source = panel('Source', 't-app-panel-dark'); source.append(code(overflowSource.split('\n').slice(0, 3).join('\n')).root);
      const left = el('div', 't-app-column'); left.append(matrix, state);
      const right = el('div', 't-app-column'); right.append(calc, instructions, source);
      const columns = el('div', 't-app-columns'); columns.append(left, right);
      content.replaceChildren(toolbar, columns);
      const regions = [toolbar, matrix, state, calc, instructions, source];
      for (;;) {
        for (const region of regions) {
          highlight(regions, 't-focus', item => regions[item] === region);
          await point(region, signal, false);
          await wait(900, signal);
        }
      }
    },
    async matrix(signal) {
      const view = el('div', 't-app-segmented');
      const grid = el('span', 't-app-button', 'Coefficient grid'), logical = el('span', 't-app-button', 'Logical rows');
      const diagonal = el('span', 't-app-check', 'Diagonal default on (1)');
      const pageSize = el('span', 't-app-select', 'Rows per page: 12');
      view.append(grid, logical, diagonal, pageSize);
      const body = el('div', 't-app-rows');
      const note = el('p', 't-app-note');
      const matrixPanel = panel('Matrix W'); matrixPanel.append(view, body, note);
      content.replaceChildren(matrixPanel);
      const showLogical = (on: 0 | 1) => {
        body.replaceChildren(...logicalLines(on));
        logical.classList.add('t-primary'); grid.classList.remove('t-primary'); diagonal.classList.toggle('t-checked', Boolean(on));
        note.textContent = on ? 'Self-weights of 1 are omitted; {} means a row that only keeps its value.' : 'Every nonzero weight is listed, including the diagonal 1s.';
      };
      const showGrid = () => {
        const table = el('div', 't-app-grid');
        table.style.gridTemplateColumns = `auto repeat(${artifact.rows.length}, 1fr)`;
        table.append(el('span', ''), ...artifact.rows.map((_, column) => el('b', '', String(column))));
        artifact.rows.forEach((row, index) => {
          table.append(el('b', '', `${index} ${name(index)}`));
          for (let column = 0; column < artifact.rows.length; column++) {
            const weight = row.cols.includes(column) ? row.weights[row.cols.indexOf(column)]! : 0;
            table.append(el('span', weight < 0 ? 't-negative' : weight ? '' : 't-zero', num(weight)));
          }
        });
        body.replaceChildren(table);
        grid.classList.add('t-primary'); logical.classList.remove('t-primary');
        note.textContent = 'The coefficient grid shows every weight, zeros included, in 12 × 12 windows.';
      };
      for (;;) {
        showLogical(1); await wait(2600, signal);
        await point(diagonal, signal); showLogical(0); await wait(2600, signal);
        await point(grid, signal); showGrid(); await wait(2800, signal);
        await point(logical, signal); await point(diagonal, signal, true);
      }
    },
    async vector(signal) {
      const toolbar = el('div', 't-app-toolbar');
      const filter = el('span', 't-app-input', '');
      const internals = el('span', 't-app-check', 'Internal circuitry');
      const changed = el('span', 't-app-check', 'Changed only');
      toolbar.append(filter, internals, changed);
      const table = el('div', 't-app-table');
      const header = el('div', 't-app-table-head');
      for (const text of ['Coordinate', 'Current xₜ', 'Before ReLU', 'After ReLU']) header.append(el('span', '', text));
      const rows = update.x.map((value, index) => {
        const row = el('div', 't-app-table-row');
        const cells = [el('span', '', `${index}  ${name(index)}`), el('span', '', String(value)), el('span', '', '—'), el('span', '', '—')];
        row.append(...cells); table.append(row); return { row, cells };
      });
      table.prepend(header);
      const legend = el('p', 't-app-note');
      legend.append(el('span', 't-negative', '■ negative'), el('span', 't-clamped', '  ■ clamped to zero'));
      const vectorPanel = panel('State vector x'); vectorPanel.append(toolbar, table, legend);
      content.replaceChildren(vectorPanel);
      for (;;) {
        filter.textContent = 'Find a coordinate…'; filter.classList.add('t-placeholder'); changed.classList.remove('t-checked');
        rows.forEach(({ row, cells }) => { row.classList.remove('t-hidden-row'); cells[2]!.textContent = '—'; cells[3]!.textContent = '—'; cells[2]!.className = ''; cells[3]!.className = ''; });
        await wait(1200, signal);
        rows.forEach(({ cells }, index) => { cells[2]!.textContent = num(update.z[index]); cells[2]!.className = update.z[index]! < 0n ? 't-negative' : ''; });
        await wait(1400, signal);
        rows.forEach(({ cells }, index) => { cells[3]!.textContent = num(update.y[index]); cells[3]!.className = update.z[index]! < 0n ? 't-clamped' : update.y[index] !== BigInt(update.x[index]!) ? 't-changed' : ''; });
        await wait(1600, signal);
        await point(filter, signal);
        filter.classList.remove('t-placeholder'); filter.textContent = '';
        for (const letter of 'below') { filter.textContent += letter; await wait(110, signal); }
        rows.forEach(({ row }, index) => row.classList.toggle('t-hidden-row', !name(index).includes('below')));
        await wait(2000, signal);
        await point(changed, signal); changed.classList.add('t-checked');
        filter.textContent = ''; filter.classList.add('t-placeholder');
        rows.forEach(({ row }, index) => row.classList.toggle('t-hidden-row', update.y[index] === BigInt(update.x[index]!)));
        await wait(2400, signal);
      }
    },
    async row(signal) {
      const holder = el('div', 't-app-focus');
      content.replaceChildren(holder);
      for (;;) {
        const below = rowCard(1);
        holder.replaceChildren(below.card);
        await wait(2600, signal);
        const next = below.terms.find(term => term.column === 0)!;
        await point(next.term, signal);
        const remaining = rowCard(0);
        holder.replaceChildren(remaining.card);
        remaining.card.classList.add('t-lit');
        await wait(3000, signal);
      }
    },
    async instructions(signal) {
      const fibonacci = fibonacciRun(5);
      const markers = fibonacci.artifact.markers;
      const source = fibonacciSource.split('\n');
      const byLine = [...new Set(markers.map(marker => marker.line))];
      const list = panel('Compiled instructions');
      const items = byLine.map(line => {
        const item = el('div', 't-app-instruction'); const dot = el('span', 't-app-dot');
        const count = markers.filter(marker => marker.line === line).length;
        item.append(dot, el('span', '', `L${line}`), el('code', '', source[line - 1]!.trim()), el('small', '', `${count} pc`));
        list.append(item); return { line, item, dot };
      });
      const detail = el('div', 't-app-pcs');
      const pcs = markers.filter(marker => marker.line === 5).map(marker => el('span', '', `line 5 → program counter #${marker.register} · ${marker.label}`));
      detail.append(...pcs);
      const listing = code(source.join('\n'));
      listing.root.classList.add('t-app-listing');
      const badge = el('span', 't-app-badge t-hidden', 'Breakpoint · line 7');
      const right = el('div', 't-app-column'); right.append(listing.root, badge);
      const left = el('div', 't-app-column'); left.append(list, detail);
      const columns = el('div', 't-app-columns'); columns.append(left, right);
      content.replaceChildren(columns);
      const lines = fibonacci.ticks.filter((tick, index) => index % 11 === 0 && tick.lines.length).map(tick => tick.lines[0]!);
      for (;;) {
        items.forEach(({ dot }) => dot.classList.remove('t-on')); listing.lines.forEach(line => line.classList.remove('t-breakpoint')); badge.classList.add('t-hidden');
        for (const line of lines.slice(0, 7)) {
          highlight(items.map(({ item }) => item), 't-lit', index => items[index]!.line === line);
          highlight(listing.lines, 't-lit', index => index + 1 === line);
          await wait(650, signal);
        }
        const target = items.find(({ line }) => line === 7)!;
        await point(target.dot, signal);
        target.dot.classList.add('t-on'); listing.lines[6]!.classList.add('t-breakpoint');
        await wait(700, signal);
        highlight(items.map(({ item }) => item), 't-lit', index => items[index]!.line === 7);
        highlight(listing.lines, 't-lit', index => index === 6);
        badge.classList.remove('t-hidden');
        await wait(2800, signal);
      }
    },
    async history(signal) {
      const fault = overflowFault();
      const snapshots = panel('Recent snapshots');
      for (const entry of [...parityHistory()].reverse()) {
        const item = el('div', 't-app-snapshot');
        item.append(el('span', '', `Tick ${entry.tick} · ${entry.changes.length} coordinate${entry.changes.length > 1 ? 's' : ''} changed`), el('small', '', entry.changes.join(', ')));
        snapshots.append(item);
      }
      const banner = el('div', 't-app-error');
      const inspect = el('span', 't-app-button', `Inspect ${fault.register}`);
      banner.append(el('code', '', fault.error), el('small', '', `While executing line ${fault.line} (main: ${fault.label})`), el('span', 't-app-button', `Show line ${fault.line}`), inspect);
      const card = el('div', 't-app-calc t-hidden');
      card.append(el('small', '', 'ROW CALCULATION'), el('strong', '', fault.register),
        ...fault.terms.map(term => { const row = el('div', `t-app-term${term.weight < 0 ? ' t-negative' : ''}`); row.append(el('span', '', `${num(term.weight)} × ${term.name.replace('main.', '')}`), el('b', '', `= ${num(BigInt(term.weight) * BigInt(term.value))}`)); return row; }),
        el('span', 't-app-result', `Sum = ${fault.sum.toLocaleString('en-US')}`),
        el('span', 't-app-overflow', `Exceeds this coordinate’s bound of ${fault.bound.toLocaleString('en-US')} by ${(fault.sum - BigInt(fault.bound)).toLocaleString('en-US')}. The update faults instead of committing; nothing wraps.`));
      const right = el('div', 't-app-column'); right.append(banner, card);
      const columns = el('div', 't-app-columns'); columns.append(snapshots, right);
      content.replaceChildren(columns);
      for (;;) {
        card.classList.add('t-hidden'); banner.classList.remove('t-lit');
        await point(snapshots, signal, false); await wait(1800, signal);
        await point(banner, signal, false); banner.classList.add('t-lit'); await wait(1600, signal);
        await point(inspect, signal); card.classList.remove('t-hidden');
        await wait(3400, signal);
      }
    },
  };
  return {
    root,
    enter(signal, beat = 'layout') {
      frame.reset();
      selectTab('Inspect');
      play(() => beats[beat]!(signal));
    },
  };
}
