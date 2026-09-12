import { expect, test, type Page } from '@playwright/test';
import { compileProgram, editSource, showTab } from './navigation';

async function open(page: Page, preset?: string): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(preset ? `/?preset=${preset}` : '/');
  await expect(page.locator('#backend')).toContainText('WASM');
  await expect(page.locator('#error')).toBeHidden();
  return errors;
}

async function expectTransport(page: Page, enabled: boolean): Promise<void> {
  for (const selector of ['#phase-step', '#step', '#run']) {
    if (enabled) await expect(page.locator(selector)).toBeEnabled();
    else await expect(page.locator(selector)).toBeDisabled();
  }
}

test('editing n restarts the finished default parity without recompiling its matrix', async ({ page }) => {
  const errors = await open(page);
  await expect(page.locator('#example')).toHaveValue('parity');
  await expect(page.locator('[data-parameter="n"]')).toHaveValue('4');
  await expect(page.locator('#status')).toHaveText('Paused');
  await expect(page.locator('#tick')).toHaveText('0');
  await page.locator('#run').click();
  await expect(page.locator('#status')).toHaveText('Ended');
  await expect(page.locator('#led-text')).toContainText('on (1)');
  await expectTransport(page, false);
  const dimensions = await page.locator('#dimensions').textContent();
  const weights = await page.locator('.math-weight-matrix .math-value').allTextContents();
  // Matrix objects should be retained: numeric input is state, not source code.
  await page.locator('.math-weight-matrix .math-value').first().evaluate(element => element.setAttribute('data-reset-test', 'retained'));

  await page.locator('[data-parameter="n"]').fill('7');

  await expect(page.locator('#tick')).toHaveText('0');
  await expect(page.locator('#status')).toHaveText('Paused');
  await expect(page.locator('#end-text')).toHaveText('End gate: 0');
  await expect(page.locator('#phase-step')).toHaveText('Multiply →');
  await expect(page.locator('#error')).toBeHidden();
  await expectTransport(page, true);
  await expect(page.locator('#dimensions')).toHaveText(dimensions!);
  await expect(page.locator('.math-weight-matrix .math-value').first()).toHaveAttribute('data-reset-test', 'retained');
  expect(await page.locator('.math-weight-matrix .math-value').allTextContents()).toEqual(weights);
  await page.locator('#run').click();
  await expect(page.locator('#status')).toHaveText('Ended');
  await expect(page.locator('#led-text')).toContainText('off (0)');
  await expect(page.locator('#error')).toBeHidden();
  expect(errors).toEqual([]);
});

test('numeric edits discard partial multiplication and ReLU previews', async ({ page }) => {
  const errors = await open(page, 'parity');
  await page.locator('#step').click();
  await page.locator('#phase-step').click();
  await page.locator('#phase-step').click();
  await expect(page.locator('#tick')).toHaveText('1');
  await expect(page.locator('#phase-step')).toHaveText('Commit tick →');
  await expect(page.locator('.math-candidate-vector .math-pending')).toHaveCount(0);

  await page.locator('[data-parameter="n"]').fill('9');

  await expect(page.locator('#tick')).toHaveText('0');
  await expect(page.locator('#status')).toHaveText('Paused');
  await expect(page.locator('#phase-step')).toHaveText('Multiply →');
  await expect(page.locator('.math-raw-vector .math-pending')).toHaveCount(6);
  await expect(page.locator('.math-candidate-vector .math-pending')).toHaveCount(6);
  await expect(page.locator('.math-current-vector [data-row="0"]')).toHaveText('9');
  await expect(page.locator('#end-text')).toHaveText('End gate: 0');
  await expectTransport(page, true);
  await page.locator('#run').click();
  await expect(page.locator('#status')).toHaveText('Ended');
  await expect(page.locator('#led-text')).toContainText('off (0)');
  expect(errors).toEqual([]);
});

test('empty and invalid numeric input blocks transport until corrected', async ({ page }) => {
  const errors = await open(page, 'parity');
  const input = page.locator('[data-parameter="n"]');
  for (const value of ['', '-1', '1.5', '4294967296']) {
    await input.fill(value);
    await expectTransport(page, false);
    await expect(page.locator('#error')).toBeVisible();
    await input.fill('8');
    await expect(page.locator('#tick')).toHaveText('0');
    await expect(page.locator('#error')).toBeHidden();
    await expectTransport(page, true);
    await page.locator('#step').click();
    await expect(page.locator('#tick')).toHaveText('1');
  }
  expect(errors).toEqual([]);
});

test('numeric edits do not clear pending source or device changes', async ({ page }) => {
  const errors = await open(page, 'parity');
  const source = page.locator('#source');
  await editSource(page, `${await source.inputValue()}\n// Source edit awaiting compilation.\n`);
  await showTab(page, 'inspect');
  await expectTransport(page, false);
  await page.locator('[data-parameter="n"]').fill('10');
  await expectTransport(page, false);
  await expect(page.locator('#dirty')).toContainText(/compile/i);
  await expect(source).toHaveValue(/Source edit awaiting compilation/);
  await compileProgram(page);
  await expectTransport(page, true);
  await expect(page.locator('#error')).toBeHidden();

  await showTab(page, 'inspect');
  await page.locator('.device-config summary').click();
  await page.locator('#enable-screen').check();
  await expectTransport(page, false);
  await page.locator('[data-parameter="n"]').fill('11');
  await expectTransport(page, false);
  await expect(page.locator('#dirty')).toContainText(/compile/i);
  await expect(page.locator('#enable-screen')).toBeChecked();
  await compileProgram(page);
  await expectTransport(page, true);
  await expect(page.locator('#error')).toBeHidden();
  expect(errors).toEqual([]);
});

test('countdown summarization is opt-in and remains compile-required after numeric edits', async ({ page }) => {
  const errors = await open(page, 'prime-simple');
  const option = page.locator('#summarize-loops');
  await expect(option).not.toBeChecked();
  await expect(page.locator('#dimensions')).toHaveText('95 × 95');
  await expectTransport(page, true);

  await showTab(page, 'inspect');
  await page.locator('.compiler-config summary').click();
  await option.check();
  await expectTransport(page, false);
  await expect(page.locator('#dirty')).toContainText('Compiler options changed');
  await page.locator('[data-parameter="n"]').fill('7');
  await expectTransport(page, false);
  await expect(option).toBeChecked();
  await expect(page.locator('#dirty')).toContainText(/compile/i);
  await expect(page.locator('#dimensions')).toHaveText('95 × 95');

  await compileProgram(page);
  await expect(page.locator('#error')).toBeHidden();
  await expect(page.locator('#tick')).toHaveText('0');
  await expect(page.locator('#dimensions')).toHaveText('106 × 106');
  await expectTransport(page, true);
  await page.locator('#run').click();
  await expect(page.locator('#status')).toHaveText('Ended');
  await expect(page.locator('#led-text')).toContainText('on (1)');
  await expect(page.locator('#error')).toBeHidden();
  expect(errors).toEqual([]);
});
