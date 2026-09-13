import { expect, test } from '@playwright/test';
import { showTab } from './navigation';

test('the matrix-computer preset prints even and odd inner traces through console ports', async ({ page }) => {
  await page.goto('/?preset=matrix-computer');
  await expect(page.locator('#backend')).toContainText('WASM');
  await expect(page.locator('[data-parameter="n"]')).toHaveValue('4');
  await expect(page.locator('#tick')).toHaveText('0');
  await expect(page.locator('#console-output')).toBeEmpty();
  await showTab(page, 'program');
  await expect(page.locator('#enable-output')).toBeChecked();
  await expect(page.locator('#enable-input')).not.toBeChecked();
  await expect(page.locator('#enable-screen')).not.toBeChecked();
  await showTab(page, 'run');
  await page.locator('#run').click();
  await expect(page.locator('#status')).toHaveText('Ended');
  await expect(page.locator('#console-output')).toContainText('z = W x = [2, -3, -2, 0, 0, 1]');
  await expect(page.locator('#console-output')).toContainText('END = 1; LED = 1 (even)');
  await page.locator('[data-parameter="n"]').fill('5');
  await expect(page.locator('#console-output')).toBeEmpty();
  await page.locator('#run').click();
  await expect(page.locator('#status')).toHaveText('Ended');
  await expect(page.locator('#console-output')).toContainText('z = W x = [3, -4, -3, 0, 0, 1]');
  await expect(page.locator('#console-output')).toContainText('END = 1; LED = 0 (odd)');
  await expect(page.locator('#error')).toBeHidden();
});
