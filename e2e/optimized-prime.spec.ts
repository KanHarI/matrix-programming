import { expect, test } from '@playwright/test';

test('optimized primality uses the smaller square recurrence and still rejects perfect squares', async ({ page }) => {
  await page.goto('/?preset=prime-optimized');
  await expect(page.locator('#backend')).toContainText('WASM');
  await expect(page.locator('#dimensions')).toHaveText('286 × 286');
  await page.locator('#run').click();
  await expect(page.locator('#status')).toHaveText('Ended');
  await expect(page.locator('#tick')).toHaveText('2,321');
  await expect(page.locator('[data-indicator="output"] .math-indicator-value')).toHaveText('1 · ON');
  for (const n of [25, 49, 121, 4294967295]) {
    await page.locator('[data-parameter="n"]').fill(String(n));
    await page.locator('#run').click();
    await expect(page.locator('#status')).toHaveText('Ended');
    await expect(page.locator('#error')).toBeHidden();
    await expect(page.locator('[data-indicator="output"] .math-indicator-value')).toHaveText('0 · OFF');
  }
});
