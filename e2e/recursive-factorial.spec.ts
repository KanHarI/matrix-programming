import { expect, test } from '@playwright/test';
import { choosePreset, showTab } from './navigation';

test('recursive factorial is a reusable preset with correct base case and overflow handling', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#backend')).toContainText('WASM');
  await choosePreset(page, 'recursive-factorial');
  await expect(page.locator('#app-panel-run')).toBeVisible();
  await expect(page.locator('[data-parameter="n"]')).toHaveValue('5');
  await expect(page.locator('#status')).toHaveText('Paused');
  await expect(page.locator('#tick')).toHaveText('0');
  await expect(page.locator('#error')).toBeHidden();
  await showTab(page, 'program');
  await expect(page.locator('#source')).toHaveValue(/rec fn factorial/);
  for (const device of ['input', 'output', 'screen']) await expect(page.locator(`#enable-${device}`)).not.toBeChecked();
  await expect(page.locator('#enable-led')).toBeChecked();
  await showTab(page, 'run');
  const output = page.locator('[data-indicator="output"]');
  await page.locator('#run').click();
  await expect(page.locator('#status')).toHaveText('Ended');
  await expect(output.locator('.math-indicator-value')).toHaveText('120 · ON');
  await expect(output).toHaveAttribute('data-final', 'true');
  await expect(page.locator('#error')).toBeHidden();
  await expect(page.locator('#console-badge')).toHaveText('not linked');
  await expect(page.locator('#screen-badge')).toHaveText('No optional devices');

  await page.locator('[data-parameter="n"]').fill('0');
  await expect(page.locator('#tick')).toHaveText('0');
  await page.locator('#run').click();
  await expect(page.locator('#status')).toHaveText('Ended');
  await expect(output.locator('.math-indicator-value')).toHaveText('1 · ON');
  await expect(output).toHaveAttribute('data-final', 'true');

  await page.locator('[data-parameter="n"]').fill('13');
  await page.locator('#run').click();
  await expect(page.locator('#status')).toHaveText('Fault');
  await expect(output).toHaveAttribute('data-final', 'false');
  await expect(page.locator('#error')).toBeVisible();
  expect(errors).toEqual([]);
});

test('GitHub icon exposes an accessible repository link', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#backend')).toContainText('WASM');
  const link = page.getByRole('link', { name: 'GitHub repository', exact: true });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('href', 'https://github.com/KanHarI/matrix-programming');
  await expect(link.locator('svg')).toHaveCount(1);
  await expect(link.locator('svg')).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('#tick')).toHaveText('0');
  await page.screenshot({ path: 'test-results/tabs-desktop.png', fullPage: true });
});
