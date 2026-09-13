import { expect, test, type Page } from '@playwright/test';
import { optimizationDefinitions } from '../src/compiler-options';
import { choosePreset, compileProgram, showTab } from './navigation';

async function openOptions(page: Page, tab: 'program' | 'inspect' = 'program') {
  await showTab(page, tab);
  const panel = page.locator('.compiler-config');
  if (!(await panel.evaluate(element => (element as HTMLDetailsElement).open))) await panel.locator('summary').click();
  return panel;
}

test('every optimization has an accessible checkbox, description, and declared default', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#backend')).toContainText('WASM');
  const options = await openOptions(page);
  await expect(options.locator('[data-optimization]')).toHaveCount(optimizationDefinitions.length);
  for (const definition of optimizationDefinitions) {
    const input = options.locator(`[data-optimization="${definition.key}"]`);
    await expect(input).toHaveAccessibleName(definition.label);
    await expect(input).toHaveAccessibleDescription(definition.description);
    if (definition.defaultEnabled) await expect(input).toBeChecked();
    else await expect(input).not.toBeChecked();
  }
  await expect(page.locator('#summarize-loops')).toHaveAttribute('data-optimization', 'loopSummaries');
  await expect(options).toContainText('Compile & reset');
});

test('disabling countdown lowering changes compilation, not the existing matrix before compile', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#backend')).toContainText('WASM');
  await expect(page.locator('#dimensions')).toHaveText('6 × 6');
  await openOptions(page, 'inspect');
  await page.locator('[data-optimization="countdown"]').uncheck();
  await expect(page.locator('#run')).toBeDisabled();
  await expect(page.locator('#dirty')).toContainText('Compiler options changed');
  await expect(page.locator('#dimensions')).toHaveText('6 × 6');
  await page.locator('[data-parameter="n"]').fill('9');
  await expect(page.locator('#run')).toBeDisabled();
  await compileProgram(page);
  await expect(page.locator('#error')).toBeHidden();
  await expect(page.locator('#dimensions')).not.toHaveText('6 × 6');
  await expect(page.locator('#tick')).toHaveText('0');
  await page.locator('#run').click();
  await expect(page.locator('#status')).toHaveText('Ended');
  await expect(page.locator('[data-indicator="output"] .math-indicator-value')).toHaveText('0 · OFF');
  await choosePreset(page, 'prime-simple');
  await expect(page.locator('[data-optimization="countdown"]')).not.toBeChecked();
  await openOptions(page);
  await page.locator('#optimizations-defaults').click();
  await expect(page.locator('[data-optimization="countdown"]')).toBeChecked();
  await expect(page.locator('#run')).toBeDisabled();
  await choosePreset(page, 'parity');
  await expect(page.locator('#dimensions')).toHaveText('6 × 6');
});

test('counter lowering can be disabled without changing primality results or resetting inputs incorrectly', async ({ page }) => {
  await page.goto('/?preset=prime-simple');
  await expect(page.locator('#backend')).toContainText('WASM');
  await expect(page.locator('#dimensions')).toHaveText('26 × 26');
  await expect(page.locator('[data-parameter="n"]')).toHaveValue('6');
  await openOptions(page, 'inspect');
  await page.locator('[data-optimization="counterMachine"]').uncheck();
  await expect(page.locator('#run')).toBeDisabled();
  await expect(page.locator('#dimensions')).toHaveText('26 × 26');
  await compileProgram(page);
  await expect(page.locator('#error')).toBeHidden();
  await expect(page.locator('#dimensions')).toHaveText('95 × 95');
  await page.locator('#run').click();
  await expect(page.locator('#status')).toHaveText('Ended');
  await expect(page.locator('[data-indicator="output"] .math-indicator-value')).toHaveText('0 · OFF');
  await page.locator('[data-parameter="n"]').fill('7');
  await expect(page.locator('#tick')).toHaveText('0');
  await expect(page.locator('#run')).toBeEnabled();
  await expect(page.locator('#dimensions')).toHaveText('95 × 95');
  await page.locator('#run').click();
  await expect(page.locator('#status')).toHaveText('Ended');
  await expect(page.locator('[data-indicator="output"] .math-indicator-value')).toHaveText('1 · ON');
});

for (const optimization of ['counterFacts', 'counterFusion']) {
  test(`${optimization} changes matrix size while preserving prime results and input reset`, async ({ page }) => {
    await page.goto('/?preset=prime-simple');
    await expect(page.locator('#backend')).toContainText('WASM');
    await expect(page.locator('#dimensions')).toHaveText('26 × 26');
    await openOptions(page, 'inspect');
    await page.locator(`[data-optimization="${optimization}"]`).uncheck();
    await page.locator('[data-parameter="n"]').fill('7');
    await expect(page.locator('#run')).toBeDisabled();
    await expect(page.locator('#dimensions')).toHaveText('26 × 26');
    await compileProgram(page);
    await expect(page.locator('#error')).toBeHidden();
    await expect(page.locator('#dimensions')).not.toHaveText('26 × 26');
    const dimension = await page.locator('#dimensions').innerText();
    await page.locator('#run').click();
    await expect(page.locator('#status')).toHaveText('Ended');
    await expect(page.locator('[data-indicator="output"] .math-indicator-value')).toHaveText('1 · ON');
    await page.locator('[data-parameter="n"]').fill('6');
    await expect(page.locator('#tick')).toHaveText('0');
    await expect(page.locator('#run')).toBeEnabled();
    await expect(page.locator('#end-text')).toHaveText('End gate: 0');
    await expect(page.locator('#dimensions')).toHaveText(dimension);
    await page.locator('#run').click();
    await expect(page.locator('#status')).toHaveText('Ended');
    await expect(page.locator('[data-indicator="output"] .math-indicator-value')).toHaveText('0 · OFF');
  });
}

test('bulk controls change all optimization flags and restore defaults without discarding source edits', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#backend')).toContainText('WASM');
  await openOptions(page);
  const source = page.locator('#source');
  const edited = `${await source.inputValue()}\n// Preserve my source while changing compiler options.\n`;
  await source.fill(edited);
  await page.locator('#optimizations-disable-all').click();
  await expect(page.locator('[data-optimization]:checked')).toHaveCount(0);
  await page.locator('#optimizations-enable-all').click();
  await expect(page.locator('[data-optimization]:checked')).toHaveCount(optimizationDefinitions.length);
  await expect(page.locator('#summarize-loops')).toBeChecked();
  await page.locator('#optimizations-defaults').click();
  await expect(page.locator('[data-optimization]:checked')).toHaveCount(optimizationDefinitions.filter(definition => definition.defaultEnabled).length);
  await expect(page.locator('#summarize-loops')).not.toBeChecked();
  await expect(source).toHaveValue(edited);
  await expect(page.locator('#run')).toBeDisabled();
});

test('compiler options stay readable and usable in Inspect at 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto('/');
  await expect(page.locator('#backend')).toContainText('WASM');
  const options = await openOptions(page, 'inspect');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  for (const definition of optimizationDefinitions) {
    const input = options.locator(`[data-optimization="${definition.key}"]`);
    await expect(input).toBeVisible();
    const label = input.locator('..');
    const box = await label.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(320);
  }
  await page.locator('#optimizations-disable-all').click();
  await page.locator('#optimizations-defaults').click();
  await expect(page.locator('[data-optimization]:checked')).toHaveCount(optimizationDefinitions.filter(definition => definition.defaultEnabled).length);
  await options.screenshot({ path: 'test-results/compiler-options-mobile.png' });
});
