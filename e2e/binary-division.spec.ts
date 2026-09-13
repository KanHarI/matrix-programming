import { expect, test } from '@playwright/test';
import { choosePreset, showTab } from './navigation';

test('binary-division preset starts paused, handles u32 input, and stays distinct from the smaller preset', async ({ page }) => {
  await page.goto('/');
  await choosePreset(page, 'prime-binary');
  await expect(page.locator('#backend')).toContainText('WASM');
  await expect(page.locator('#dimensions')).toHaveText('314 × 314');
  await expect(page.locator('[data-parameter="n"]')).toHaveValue('4294967295');
  await expect(page.locator('#tick')).toHaveText('0');
  await page.locator('#run').click();
  await expect(page.locator('#status')).toHaveText('Ended');
  await expect(page.locator('#tick')).toHaveText('6,490');
  await expect(page.locator('[data-indicator="output"] .math-indicator-value')).toHaveText('0 · OFF');
  for (const n of [97, 49]) {
    await page.locator('[data-parameter="n"]').fill(String(n));
    await expect(page.locator('#tick')).toHaveText('0');
    await page.locator('#run').click();
    await expect(page.locator('#status')).toHaveText('Ended');
    await expect(page.locator('#error')).toBeHidden();
    await expect(page.locator('[data-indicator="output"] .math-indicator-value')).toHaveText(n === 97 ? '1 · ON' : '0 · OFF');
  }
  for (const tab of ['presets', 'program', 'inspect', 'run'] as const) {
    await showTab(page, tab);
    await expect(page.locator('#active-program-name')).toHaveText('Primality · binary division');
  }
  await choosePreset(page, 'prime-optimized');
  await expect(page.locator('#dimensions')).toHaveText('286 × 286');
});
