import { expect, test } from '@playwright/test';
import { choosePreset, setDevice, showTab } from './navigation';

test('small matrices show every numerical weight and all three vector phases', async ({ page }) => {
  await page.goto('/?preset=parity');
  await expect(page.locator('#backend')).toContainText('WASM');
  const overview = page.locator('#math-overview');
  await expect(overview).toBeVisible();
  await expect(page.locator('#app-panel-run')).toBeVisible();
  await expect(page.locator('#app-panel-presets')).toBeHidden();
  await expect(overview.locator('.math-weight-matrix .math-value')).toHaveCount(36);
  await expect(overview.locator('.math-current-vector .math-value')).toHaveCount(6);
  await expect(overview.locator('.math-weight-matrix .math-zero').first()).toHaveText('0');
  await expect(overview.locator('.math-raw-vector .math-pending')).toHaveCount(6);
  await expect(overview.locator('.math-candidate-vector .math-pending')).toHaveCount(6);
  const before = await overview.locator('.math-current-vector .math-value').allTextContents();
  await page.locator('#phase-step').click();
  await expect(overview.locator('.math-raw-vector .math-pending')).toHaveCount(0);
  await expect(overview.locator('.math-raw-vector .math-negative').first()).toBeVisible();
  await expect(overview.locator('.math-candidate-vector .math-pending')).toHaveCount(6);
  expect(await overview.locator('.math-current-vector .math-value').allTextContents()).toEqual(before);
  await page.locator('#phase-step').click();
  await expect(overview.locator('.math-candidate-vector .math-pending')).toHaveCount(0);
  await expect(overview.locator('.math-candidate-vector .math-clamped').first()).toHaveText('0');
  await expect(page.locator('#tick')).toHaveText('0');
  expect(await overview.locator('.math-current-vector .math-value').allTextContents()).toEqual(before);
  await overview.locator('.math-weight-matrix [data-row="2"][data-column="1"]').click();
  await expect(page.locator('#row-name')).toContainText('[2]');
  await expect(page.locator('#app-panel-inspect')).toBeVisible();
  await showTab(page, 'run');
  await page.screenshot({ path: 'test-results/math-overview-desktop.png', fullPage: true });
  const candidate = await overview.locator('.math-candidate-vector .math-value').allTextContents();
  await page.locator('#phase-step').click();
  expect(await overview.locator('.math-current-vector .math-value').allTextContents()).toEqual(candidate);
  await expect(overview.locator('.math-raw-vector .math-pending')).toHaveCount(6);
});

test('large matrices are explicit excerpts, not false truncated equations', async ({ page }) => {
  await page.goto('/?preset=parity');
  await expect(page.locator('#backend')).toContainText('WASM');
  await choosePreset(page, 'hello');
  const overview = page.locator('#math-overview');
  await expect(overview.locator('.math-weight-matrix .math-value')).toHaveCount(64);
  await expect(overview.locator('.math-current-vector .math-value')).toHaveCount(8);
  await expect(overview.locator('.math-weight-matrix .math-ellipsis')).toHaveCount(17);
  await expect(overview.locator('.math-excerpt-note')).toContainText('including coordinates not shown');
  await expect(overview.locator('.math-objects .math-operation')).toHaveCount(0);
  await choosePreset(page, 'greeting');
  await expect(overview.locator('.math-input-note')).toContainText('B · u');
  await expect(overview.locator('.math-formula')).toHaveAttribute('aria-label', /plus B times u/);
});

test('mathematical overview scrolls internally on small screens', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?preset=parity');
  await expect(page.locator('#backend')).toContainText('WASM');
  await expect(page.locator('#math-overview .math-weight-matrix')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const scrolls = await page.locator('#math-overview .math-scroll').evaluate(element => element.scrollWidth > element.clientWidth);
  expect(scrolls).toBe(true);
  await page.screenshot({ path: 'test-results/math-overview-mobile.png', fullPage: true });
});

test('LED and END coordinates are highlighted without lighting uncommitted previews', async ({ page }) => {
  await page.goto('/?preset=parity');
  await expect(page.locator('#backend')).toContainText('WASM');
  const overview = page.locator('#math-overview');
  await expect(overview.locator('.math-weight-matrix .math-led-coordinate')).toHaveCount(6);
  await expect(overview.locator('.math-weight-matrix .math-end-coordinate')).toHaveCount(6);
  for (const kind of ['current', 'raw', 'candidate']) {
    await expect(overview.locator(`.math-${kind}-vector .math-led-coordinate`)).toHaveCount(1);
    await expect(overview.locator(`.math-${kind}-vector .math-end-coordinate`)).toHaveCount(1);
  }
  await expect(overview.locator('.math-coordinate.math-led-coordinate')).toContainText('LED');
  await expect(overview.locator('.math-coordinate.math-end-coordinate')).toContainText('END');
  const led = overview.locator('[data-gate="led"]');
  const end = overview.locator('[data-gate="end"]');
  await expect(led.locator('.math-gate-status')).toHaveText('off');
  await expect(end.locator('.math-gate-status')).toHaveText('waiting');

  // n = 0 ends on tick 2. Tick 1's next-state preview must not light the gates.
  await page.locator('[data-parameter="n"]').fill('0');
  await page.locator('#step').click();
  await page.locator('#phase-step').click();
  await page.locator('#phase-step').click();
  await expect(overview.locator('.math-candidate-vector .math-end-coordinate')).toHaveText('1');
  await expect(overview.locator('.math-current-vector .math-end-coordinate')).toHaveText('0');
  await expect(end.locator('.math-gate-status')).toHaveText('waiting');
  await expect(end).toHaveAttribute('data-active', 'false');
  await expect(led).toHaveAttribute('data-active', 'false');
  await page.locator('#phase-step').click();
  await expect(end.locator('.math-gate-status')).toHaveText('ended');
  await expect(led.locator('.math-gate-status')).toHaveText('on');
  await page.screenshot({ path: 'test-results/math-gates.png', fullPage: true });

  for (const [n, status] of [['42', 'on'], ['43', 'off']]) {
    await page.locator('[data-parameter="n"]').fill(n);
    await page.locator('#run').click();
    await expect(page.locator('#status')).toHaveText('Ended');
    await expect(led.locator('.math-gate-status')).toHaveText(status);
    await expect(end.locator('.math-gate-status')).toHaveText('ended');
  }
});

test('disabling the LED removes its annotation without changing the matrix or tick', async ({ page }) => {
  await page.goto('/?preset=parity');
  await expect(page.locator('#backend')).toContainText('WASM');
  const overview = page.locator('#math-overview');
  const weights = await overview.locator('.math-weight-matrix .math-value').allTextContents();
  await page.locator('#step').click();
  const tick = await page.locator('#tick').textContent();
  await setDevice(page, 'led', false);
  await expect(overview.locator('[data-gate="led"] .math-gate-status')).toHaveText('disabled');
  await expect(overview.locator('[data-gate="led"]')).toHaveAttribute('data-active', 'false');
  await expect(overview.locator('.math-led-coordinate')).toHaveCount(0);
  await expect(overview.locator('.math-current-vector .math-end-coordinate')).toHaveCount(1);
  await expect(page.locator('#tick')).toHaveText(tick!);
  expect(await overview.locator('.math-weight-matrix .math-value').allTextContents()).toEqual(weights);
  await expect(page.locator('#run')).toBeEnabled();
  await setDevice(page, 'led', true);
  await expect(overview.locator('.math-current-vector .math-led-coordinate')).toHaveCount(1);
  await expect(page.locator('#tick')).toHaveText(tick!);
});

test('a coordinate may be both the LED binding and the end gate', async ({ page }) => {
  await page.goto('/?preset=parity');
  await expect(page.locator('#backend')).toContainText('WASM');
  await page.evaluate(async () => {
    const overviewPath = '/src/math-overview.ts';
    const runtimePath = '/src/runtime.ts';
    const { MathOverview } = await import(overviewPath);
    const { Machine } = await import(runtimePath);
    const artifact = {
      version: 1, name: 'Shared gate fixture', source: '',
      rows: [{ cols: [0], weights: [1] }],
      registers: [{ name: 'shared', kind: 'data', bound: 1 }],
      initial: [1], inputs: {}, result: 0, end: 0, led: 0, devices: {}, markers: [],
      stats: { instructions: 0, contexts: 1, functionInstances: [] },
    };
    new MathOverview(document.getElementById('math-overview')!, () => {}).render(artifact, new Machine(artifact));
  });
  const overview = page.locator('#math-overview');
  await expect(overview.locator('.math-weight-matrix .math-led-coordinate.math-end-coordinate')).toHaveCount(1);
  await expect(overview.locator('.math-current-vector .math-led-coordinate.math-end-coordinate')).toHaveCount(1);
  await expect(overview.locator('.math-coordinate')).toContainText('LED · END');
  await expect(overview.locator('[data-gate="led"] .math-gate-status')).toHaveText('on');
  await expect(overview.locator('[data-gate="end"] .math-gate-status')).toHaveText('ended');
});
