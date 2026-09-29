import { expect, test, type Page } from '@playwright/test';
import { choosePreset, compileProgram, editSource, showTab } from './navigation';

const fibonacci = `// Fibonacci: returns F(n)
fn main(n) {
  let a = 0;
  let b = 1;
  while (n > 0) {
    let t = a + b;
    a = b;
    b = t;
    n = n - 1;
  }
  return a;
}`;

async function open(page: Page, preset = 'parity') {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`/?preset=${preset}`);
  await expect(page.locator('#backend')).toContainText('WASM');
  return errors;
}
async function loadFibonacci(page: Page, n: number) {
  await editSource(page, fibonacci);
  await compileProgram(page);
  await page.locator('[data-parameter="n"]').fill(String(n));
  await expect(page.locator('#dimensions')).not.toHaveText('—');
}
/** Committed coordinate value from the Inspect state-vector table. */
async function value(page: Page, name: string): Promise<string> {
  await page.locator('#filter').fill(name);
  return (await page.locator('#vector-body tr', { hasText: name }).first().locator('td').nth(1).textContent())!;
}

test('breakpoints from the gutter and the instruction list pause Run when their line starts', async ({ page }) => {
  const errors = await open(page);
  await loadFibonacci(page, 10);
  await showTab(page, 'inspect');
  await expect(page.locator('#instruction-list .instruction-line')).toHaveCount(8);
  await expect(page.locator('.instruction-line[data-line="3"]')).toHaveClass(/active/);
  // Line 7 is `a = b;`: toggle it from the instruction list; line 2 has no instruction.
  await page.locator('.instruction-line[data-line="7"] .breakpoint-toggle').click();
  await expect(page.locator('.instruction-line[data-line="7"] .breakpoint-toggle')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#line-numbers [data-line="7"]')).toHaveClass(/breakpoint/);
  await page.locator('#run').click();
  await expect(page.locator('#pause-reason')).toHaveText('Breakpoint · line 7');
  await expect(page.locator('#status')).toHaveText('Paused');
  await expect(page.locator('#tick')).toHaveText('44');
  await expect(page.locator('#active-source')).toHaveText('Line 7');
  await page.locator('#run').click();
  await expect(page.locator('#tick')).toHaveText('99');
  expect(await value(page, 'main.main.n')).toBe('9');
  // Removing it from the gutter lets the program finish.
  await page.locator('#line-numbers [data-line="7"]').click();
  await expect(page.locator('.instruction-line[data-line="7"] .breakpoint-toggle')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#run').click();
  await expect(page.locator('#status')).toHaveText('Ended');
  await expect(page.locator('#led-text')).toContainText('(55)');
  expect(errors).toEqual([]);
});

test('Step line advances one source line at a time and keyboard shortcuts drive the transport', async ({ page }) => {
  const errors = await open(page);
  await loadFibonacci(page, 2);
  await showTab(page, 'inspect');
  const lines: string[] = [];
  for (let i = 0; i < 6; i++) {
    await page.locator('#step-line').click();
    await expect(page.locator('#pause-reason')).toBeVisible();
    lines.push((await page.locator('#pause-reason').textContent())!);
  }
  expect(lines).toEqual(['Line 4', 'Line 5', 'Line 6', 'Line 7', 'Line 8', 'Line 9']);
  await expect(page.locator('#tick')).toHaveText('66');
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('l');
  await expect(page.locator('#pause-reason')).toHaveText('Line 5');
  await page.keyboard.press('t');
  await expect(page.locator('#tick')).toHaveText('78');
  await page.keyboard.press('.');
  await expect(page.locator('#phase-step')).toHaveText('Apply ReLU →');
  await page.keyboard.press('.');
  await page.keyboard.press('.');
  await expect(page.locator('#tick')).toHaveText('79');
  // Shortcuts never fire while typing.
  await page.locator('#filter').click();
  await page.keyboard.type('t');
  await expect(page.locator('#tick')).toHaveText('79');
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('r');
  await expect(page.locator('#status')).toHaveText('Ended');
  await expect(page.locator('#led-text')).toContainText('(1)');
  expect(errors).toEqual([]);
});

test('specialized lowerings explain why line stepping is unavailable', async ({ page }) => {
  const errors = await open(page);
  // Parity's fused countdown keeps a single marker for its loop line.
  await expect(page.locator('#step-line')).toBeEnabled();
  // A straight-line affine program compiles to a feed-forward circuit without program counters.
  await editSource(page, 'fn main(a, b) {\n  let c = a + b;\n  return c + 1;\n}');
  await compileProgram(page);
  await expect(page.locator('#step-line')).toBeDisabled();
  await expect(page.locator('#step-line')).toHaveAttribute('title', /specialized lowering/);
  await showTab(page, 'inspect');
  await expect(page.locator('#instruction-summary')).toContainText('specialized lowering');
  await choosePreset(page, 'prime-simple');
  await expect(page.locator('#step-line')).toBeEnabled();
  expect(errors).toEqual([]);
});

test('an overflow fault names its value and source line and opens the faulting row', async ({ page }) => {
  const errors = await open(page, 'recursive-factorial');
  await page.locator('[data-parameter="n"]').fill('13');
  await page.locator('#run').click();
  await expect(page.locator('#status')).toHaveText('Fault');
  await expect(page.locator('#error')).toContainText('Register main.alu exceeds its 4294967295 bound (4311014400)');
  await expect(page.locator('#error')).toContainText('While executing line 7');
  await page.locator('#error').getByRole('button', { name: 'Inspect main.alu' }).click();
  await expect(page.locator('#app-panel-inspect')).toBeVisible();
  await expect(page.locator('#row-name')).toHaveText('[806] main.alu');
  await expect(page.locator('.row-detail')).toBeInViewport();
  await expect(page.locator('#row-calculation')).toContainText('Sum = 4311014400');
  await expect(page.locator('.calculation-overflow')).toContainText('by 16,047,105');
  await expect(page.locator('.instruction-line[data-line="7"]')).toHaveClass(/active/);
  await page.locator('#error').getByRole('button', { name: 'Show line 7' }).click();
  expect(await page.locator('#source').evaluate((element: HTMLTextAreaElement) => element.value.slice(element.selectionStart, element.selectionEnd))).toContain('product = product + value;');
  expect(errors).toEqual([]);
});

test('syntax errors use source terms, mark the line, and link to it', async ({ page }) => {
  const errors = await open(page);
  await editSource(page, fibonacci.replace('let b = 1;', 'let b = 1'));
  await compileProgram(page);
  await expect(page.locator('#app-tab-program')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#error')).toContainText("Line 4, column 12: Missing ';' after '1' (found 'while' on line 5)");
  await expect(page.locator('#error')).not.toContainText('-->');
  await expect(page.locator('#line-numbers [data-line="4"]')).toHaveClass(/error-line/);
  await page.locator('#error').getByRole('button', { name: 'Show line 4' }).click();
  await expect(page.locator('#source')).toBeFocused();
  expect(await page.locator('#source').evaluate((element: HTMLTextAreaElement) => element.value.slice(element.selectionStart, element.selectionEnd))).toBe('  let b = 1');
  expect(errors).toEqual([]);
});

test('inspecting finds internal circuitry by name and shows where a row comes from', async ({ page }) => {
  const errors = await open(page, 'recursive-factorial');
  await showTab(page, 'inspect');
  await expect(page.locator('#internals')).not.toBeChecked();
  await expect(page.locator('#visible-count')).toContainText('internal hidden');
  await page.locator('#filter').fill('main.alu');
  await expect(page.locator('#vector-body tr').first()).toContainText('main.alu');
  await page.locator('#filter').fill('main.pc.0.');
  await page.locator('#vector-body tr').first().click();
  await expect(page.locator('#row-meta')).toContainText('program counter');
  await expect(page.locator('#row-meta .row-meta-line')).toHaveText(/^Line \d+$/);
  expect(errors).toEqual([]);
});

test('clicking a coordinate in Run brings its row calculation into view, and logical rows can show more per page', async ({ page }) => {
  const errors = await open(page);
  await page.locator('#step').click();
  // The committed update changed n (42 → 40); the view marks it until the next phase.
  await expect(page.locator('.math-current-vector [data-row="0"]')).toHaveClass(/math-changed/);
  await expect(page.locator('#history li').first()).toContainText('main.main.remaining 42→40');
  await page.locator('#phase-step').click();
  await expect(page.locator('.math-current-vector .math-changed')).toHaveCount(0);
  await page.locator('.math-current-vector [data-row="4"]').click();
  await expect(page.locator('#app-panel-inspect')).toBeVisible();
  await expect(page.locator('#row-name')).toHaveText('[4] end');
  await expect(page.locator('.row-detail')).toBeInViewport();
  await choosePreset(page, 'hello');
  await showTab(page, 'inspect');
  await expect(page.locator('.matrix-logical-row')).toHaveCount(12);
  await page.locator('#matrix-page-size').selectOption('48');
  await expect(page.locator('.matrix-logical-row')).toHaveCount(48);
  await expect(page.locator('#matrix-range')).toContainText('Rows 0–47');
  expect(errors).toEqual([]);
});

test('the transport stays on screen while scrolling a large matrix view', async ({ page }) => {
  const errors = await open(page, 'greeting');
  await page.mouse.wheel(0, 900);
  await expect(page.locator('#phase-step')).toBeInViewport();
  await showTab(page, 'inspect');
  await page.mouse.wheel(0, 1500);
  await expect(page.locator('#run')).toBeInViewport();
  expect(errors).toEqual([]);
});

test('the preset gallery shows every program with its inputs and devices', async ({ page }) => {
  const errors = await open(page);
  await showTab(page, 'presets');
  await expect(page.locator('.preset-card')).toHaveCount(9);
  await expect(page.locator('.preset-card[data-preset="greeting"] .preset-card-tags')).toContainText('console in');
  await expect(page.locator('.preset-card[data-preset="hello"] .preset-card-tags')).toContainText('screen');
  await expect(page.locator('.preset-card[data-preset="recursive-factorial"] .preset-card-tags')).toContainText('recursion');
  await page.locator('.preset-card[data-preset="greeting"]').click();
  await expect(page.locator('#app-panel-program')).toBeVisible();
  await expect(page.locator('#source')).toHaveValue(/read\(/);
  await expect(page.locator('#screen-badge')).toHaveText('No screen');
  await showTab(page, 'presets');
  await expect(page.locator('.preset-card[aria-current="true"]')).toHaveAttribute('data-preset', 'greeting');
  expect(errors).toEqual([]);
});
