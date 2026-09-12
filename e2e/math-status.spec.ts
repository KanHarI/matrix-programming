import { expect, test, type Page } from '@playwright/test';

async function open(page: Page, preset = 'parity'): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`/?preset=${preset}`);
  await expect(page.locator('#backend')).toContainText('WASM');
  await expect(page.locator('#error')).toBeHidden();
  await expect(page.locator('.math-status-panel')).toBeVisible();
  return errors;
}

test('input highlights identify actual coordinates and report committed evolving values', async ({ page }) => {
  const errors = await open(page);
  const overview = page.locator('#math-overview');
  const inputBadge = overview.locator('[data-input="n"]');
  await expect(inputBadge).toContainText('= 42');
  await expect(overview.locator('.math-weight-matrix .math-input-coordinate')).toHaveCount(0);
  await expect(overview.locator('.math-current-vector .math-input-coordinate')).toHaveCount(1);
  for (const kind of ['raw', 'candidate']) {
    await expect(overview.locator(`.math-${kind}-vector .math-input-coordinate`)).toHaveCount(0);
  }
  await expect(overview.locator('.math-coordinate.math-input-coordinate')).toHaveCount(0);
  await expect(overview.locator('.math-coordinate').filter({ hasText: 'INPUT n' })).toHaveCount(1);
  await page.locator('#phase-step').click();
  await page.locator('#phase-step').click();
  await expect(overview.locator('.math-candidate-vector [data-row="0"]')).toHaveText('40');
  await expect(inputBadge).toContainText('= 42');
  await page.locator('#phase-step').click();
  await expect(inputBadge).toContainText('= 40');
  await expect(page.locator('[data-parameter="n"]')).toHaveValue('42');
  await inputBadge.click();
  await expect(page.locator('#row-name')).toContainText('[0]');
  expect(errors).toEqual([]);
});

test('multiple named inputs retain separate badges and highlights when the LED is disabled', async ({ page }) => {
  const errors = await open(page);
  await page.locator('#source').fill('fn main(a, b) { return a + b; }');
  await page.locator('#compile').click();
  await expect(page.locator('#error')).toBeHidden();
  await page.locator('[data-parameter="a"]').fill('3');
  await page.locator('[data-parameter="b"]').fill('4');
  const overview = page.locator('#math-overview');
  await expect(overview.locator('[data-input="a"]')).toContainText('= 3');
  await expect(overview.locator('[data-input="b"]')).toContainText('= 4');
  await expect(overview.locator('.math-current-vector .math-input-coordinate')).toHaveCount(2);
  await expect(overview.locator('.math-coordinate.math-input-coordinate')).toHaveCount(0);
  await expect(overview.locator('.math-coordinate').filter({ hasText: 'INPUT' })).toHaveCount(2);
  await page.locator('.device-config summary').click();
  await page.locator('#enable-led').uncheck();
  await expect(overview.locator('.math-led-coordinate')).toHaveCount(0);
  await expect(overview.locator('.math-current-vector .math-input-coordinate')).toHaveCount(2);
  await expect(overview.locator('[data-input="a"]')).toContainText('= 3');
  await expect(overview.locator('[data-input="b"]')).toContainText('= 4');
  await expect(overview.locator('[data-indicator="output"] .math-indicator-value')).toHaveText('—');
  await page.locator('#enable-led').check();
  await page.locator('#run').click();
  await expect(page.locator('#status')).toHaveText('Ended');
  await expect(overview.locator('[data-indicator="output"] .math-indicator-value')).toHaveText('7 · ON');
  await expect(overview.locator('[data-indicator="output"]')).toHaveAttribute('data-final', 'true');
  expect(errors).toEqual([]);
});

test('output becomes final only after commit, independently of the running indicator', async ({ page }) => {
  const errors = await open(page);
  const running = page.locator('[data-indicator="running"]');
  const output = page.locator('[data-indicator="output"]');
  await expect(running.locator('.math-indicator-value')).toHaveText('Paused');
  await expect(running).toHaveAttribute('data-active', 'false');
  await expect(output.locator('.math-indicator-value')).toHaveText('0 · OFF');
  await expect(output).toHaveAttribute('data-final', 'false');
  await page.locator('[data-parameter="n"]').fill('0');
  await page.locator('#step').click();
  await page.locator('#phase-step').click();
  await page.locator('#phase-step').click();
  await expect(page.locator('.math-candidate-vector .math-end-coordinate')).toHaveText('1');
  await expect(output.locator('.math-indicator-value')).toHaveText('0 · OFF');
  await expect(output).toHaveAttribute('data-final', 'false');
  await expect(running.locator('.math-indicator-value')).toHaveText('Paused');
  await page.locator('#phase-step').click();
  await expect(running.locator('.math-indicator-value')).toHaveText('Ended');
  await expect(running).toHaveAttribute('data-active', 'false');
  await expect(output.locator('.math-indicator-value')).toHaveText('1 · ON');
  await expect(output).toHaveAttribute('data-final', 'true');
  await expect(output.locator('.math-indicator-note')).toContainText(/final/i);
  await page.locator('.device-config summary').click();
  await page.locator('#enable-led').uncheck();
  await expect(running.locator('.math-indicator-value')).toHaveText('Ended');
  await expect(output.locator('.math-indicator-value')).toHaveText('—');
  await expect(output).toHaveAttribute('data-final', 'false');
  await expect(output.locator('.math-indicator-note')).toContainText(/disabled/i);
  await page.locator('#enable-led').check();
  await expect(output.locator('.math-indicator-value')).toHaveText('1 · ON');
  await expect(output).toHaveAttribute('data-final', 'true');
  expect(errors).toEqual([]);
});

test('execution indicator distinguishes running, paused, blocked input and faults', async ({ page }) => {
  const errors = await open(page);
  const running = page.locator('[data-indicator="running"]');
  const output = page.locator('[data-indicator="output"]');
  await page.locator('[data-parameter="n"]').fill('4294967295');
  await page.locator('#run').click();
  await expect(running.locator('.math-indicator-value')).toHaveText('Running');
  await expect(running).toHaveAttribute('data-active', 'true');
  await page.locator('#run').click();
  await expect(running.locator('.math-indicator-value')).toHaveText('Paused');
  await expect(running).toHaveAttribute('data-active', 'false');
  await expect(output).toHaveAttribute('data-final', 'false');
  await page.locator('#example').selectOption('greeting');
  await page.locator('#run').click();
  await expect(running.locator('.math-indicator-value')).toHaveText('Waiting for input');
  await expect(running).toHaveAttribute('data-active', 'false');
  await expect(output).toHaveAttribute('data-final', 'false');
  await page.locator('#example').selectOption('parity');
  await page.locator('#source').fill('fn main(n) { return n + 1; }');
  await page.locator('#compile').click();
  await expect(page.locator('#error')).toBeHidden();
  await page.locator('[data-parameter="n"]').fill('4294967295');
  await page.locator('#run').click();
  await expect(running.locator('.math-indicator-value')).toHaveText('Fault');
  await expect(running).toHaveAttribute('data-active', 'false');
  await expect(output).toHaveAttribute('data-final', 'false');
  await expect(page.locator('#error')).toBeVisible();
  expect(errors).toEqual([]);
});

for (const width of [320, 390, 768, 1440]) {
  test(`matrix status stays readable without page overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const errors = await open(page);
    for (const preset of ['parity', 'prime-simple', 'greeting']) {
      await page.locator('#example').selectOption(preset);
      await expect(page.locator('#error')).toBeHidden();
      const overflow = await page.evaluate(() => ({
        width: document.documentElement.scrollWidth,
        containers: [...document.querySelectorAll<HTMLElement>('main, .masthead, .intro, .equation, .workspace, .panel, .math-stage-layout, .math-status-panel, .transport')]
          .map(element => ({ selector: `${element.tagName.toLowerCase()}.${element.className}`, right: element.getBoundingClientRect().right, width: element.getBoundingClientRect().width }))
          .filter(box => box.right > innerWidth || box.width > innerWidth),
      }));
      expect(overflow.width, `${preset} at ${width}px; overflowing containers: ${JSON.stringify(overflow.containers)}`).toBeLessThanOrEqual(width);
      const matrix = await page.locator('#math-overview .math-scroll').boundingBox();
      const status = await page.locator('#math-overview .math-status-panel').boundingBox();
      expect(matrix).not.toBeNull();
      expect(status).not.toBeNull();
      if (width > 900) expect(status!.x).toBeGreaterThanOrEqual(matrix!.x + matrix!.width - 1);
      else expect(status!.y).toBeGreaterThanOrEqual(matrix!.y + matrix!.height - 1);
      const output = await page.locator('[data-indicator="output"]').boundingBox();
      expect(output!.x).toBeGreaterThanOrEqual(0);
      expect(output!.x + output!.width).toBeLessThanOrEqual(width);
      if (preset === 'parity' && [320, 390, 1440].includes(width)) {
        await page.locator('#run').click();
        await expect(page.locator('#status')).toHaveText('Ended');
        await expect(page.locator('[data-indicator="output"]')).toHaveAttribute('data-final', 'true');
        await page.locator('.execution-workspace').screenshot({ path: `test-results/math-status-${width}.png` });
      }
    }
    expect(errors).toEqual([]);
  });
}
