import { expect, test } from '@playwright/test';

test('page load runs simple primality for six and omits the removed parity preset', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#backend')).toContainText('WASM');
  await expect(page.locator('#example')).toHaveValue('prime-simple');
  await expect(page.locator('[data-parameter="n"]')).toHaveValue('6');
  await expect(page.locator('#status')).toHaveText('Ended');
  await expect(page.locator('#led-text')).toContainText('off (0)');
  await expect(page.locator('#end-text')).toHaveText('End gate: 1');
  expect(await page.locator('#example option').allTextContents()).not.toContain('Parity · faster algorithm');
  await expect(page.locator('#example option[value="parity-fast"]')).toHaveCount(0);
});

test('characters immediately resume a playing input-blocked program without an implicit newline', async ({ page }) => {
  await page.goto('/?preset=greeting');
  await expect(page.locator('#backend')).toContainText('WASM');
  await page.locator('#run').click();
  await expect(page.locator('#status')).toHaveText('Waiting for input');
  await expect(page.locator('#run')).toHaveText('Ⅱ Pause');
  const tick = Number((await page.locator('#tick').textContent())!.replaceAll(',', ''));
  await page.locator('#console-input').pressSequentially('A');
  await expect.poll(async () => Number((await page.locator('#tick').textContent())!.replaceAll(',', ''))).toBeGreaterThan(tick);
  await expect(page.locator('#status')).toHaveText('Waiting for input');
  await expect(page.locator('#console-output')).toHaveText('What is your name? ');
  await expect(page.locator('#console-input')).toHaveValue('');
  await page.locator('#console-input').fill('da 🌍');
  await page.locator('#console-input').press('Enter');
  await expect(page.locator('#status')).toHaveText('Ended');
  await expect(page.locator('#console-output')).toHaveText('What is your name? Greetings, Ada 🌍\n');
});

test('manual pause cancels input auto-resume; EOF resumes only a playing run', async ({ page }) => {
  await page.goto('/?preset=greeting');
  await expect(page.locator('#backend')).toContainText('WASM');
  await page.locator('#run').click();
  await expect(page.locator('#status')).toHaveText('Waiting for input');
  await page.locator('#run').click(); // Pause while blocked.
  const tick = await page.locator('#tick').textContent();
  await page.locator('#console-input').fill('X');
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(page.locator('#tick')).toHaveText(tick!);
  await expect(page.locator('#run')).toHaveText('▶ Run');
  await page.locator('#run').click();
  await expect(page.locator('#status')).toHaveText('Waiting for input');
  await page.locator('#send-eof').click();
  await expect(page.locator('#status')).toHaveText('Ended');
  await expect(page.locator('#console-output')).toHaveText('What is your name? Greetings, X\n');
});
