import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function open(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?preset=parity');
  await expect(page.locator('#backend')).toContainText('WASM');
  await expect(page.locator('#error')).toBeHidden();
  return errors;
}
async function example(page: Page, id: string) {
  await page.locator('#example').selectOption(id);
  await expect(page.locator('#error')).toBeHidden();
  await expect(page.locator('#tick')).toHaveText('0');
}
async function run(page: Page, status = 'Ended') {
  await page.locator('#run').click();
  await expect(page.locator('#status')).toHaveText(status);
  await expect(page.locator('#error')).toBeHidden();
}

test('phase debugger exposes exact multiplication, ReLU and atomic commit', async ({ page }) => {
  const errors = await open(page);
  await page.locator('#internals').check();
  await page.locator('#filter').fill('belowStride');
  await page.locator('#phase-step').click();
  await expect(page.locator('#phase-step')).toHaveText('Apply ReLU →');
  await expect(page.locator('#tick')).toHaveText('0');
  await expect(page.locator('.negative-value').first()).toBeVisible();
  await expect(page.locator('#console-output')).toBeEmpty();
  await page.locator('#phase-step').click();
  await expect(page.locator('#phase-step')).toHaveText('Commit tick →');
  await expect(page.locator('#tick')).toHaveText('0');
  await expect(page.locator('.clipped-value').first()).toBeVisible();
  await page.locator('.negative-value').first().click();
  await expect(page.locator('#row-calculation')).toContainText('negative value is clipped');
  await page.locator('#phase-step').click();
  await expect(page.locator('#tick')).toHaveText('1');
  await expect(page.locator('#phase-step')).toHaveText('Multiply →');
  await page.locator('#matrix-tab').click();
  await expect(page.locator('#matrix-canvas')).toBeVisible();
  await page.locator('#matrix-canvas').click({ position: { x: 35, y: 25 } });
  await expect(page.locator('#matrix-hover')).toContainText('Destination row');
  await run(page);
  await expect(page.locator('#led-text')).toContainText('on (1)');
  await expect(page.locator('#end-text')).toHaveText('End gate: 1');
  expect(errors).toEqual([]);
});

test('all numeric examples run and device toggles do not enlarge parity', async ({ page }) => {
  const errors = await open(page);
  const dimensions = await page.locator('#dimensions').textContent();
  await page.locator('.device-config').click();
  await page.locator('#step').click();
  const tick = await page.locator('#tick').textContent();
  await page.locator('#enable-led').uncheck();
  await expect(page.locator('#tick')).toHaveText(tick!);
  await expect(page.locator('#run')).toBeEnabled();
  await expect(page.locator('#dirty')).toHaveText('Compiled · fixed sparse matrix');
  for (const device of ['led', 'output', 'input', 'screen']) await page.locator(`#enable-${device}`).uncheck();
  await page.locator('#compile').click();
  await expect(page.locator('#dimensions')).toHaveText(dimensions!);
  await expect(page.locator('#led-text')).toHaveText('LED disabled');
  for (const id of ['prime-simple', 'prime-optimized', 'parallel']) {
    await example(page, id);
    await run(page);
  }
  expect(errors).toEqual([]);
});

test('hello emits exact console text and H pixels', async ({ page }) => {
  const errors = await open(page);
  await example(page, 'hello');
  await run(page);
  await expect(page.locator('#console-output')).toHaveText('Hello, world!\n');
  await expect(page.locator('#screen-badge')).toHaveText('6 coordinates');
  const pixels = await page.locator('#screen').evaluate((canvas: HTMLCanvasElement) => [...canvas.getContext('2d')!.getImageData(0, 0, 16, 16).data]);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const on = ((x === 4 || x === 11) && y >= 3 && y <= 12) || (y === 7 && x >= 4 && x <= 11);
    expect(pixels.slice((y * 16 + x) * 4, (y * 16 + x) * 4 + 3)).toEqual(on ? [80, 220, 190] : [0, 0, 0]);
  }
  await page.screenshot({ path: 'test-results/hello-desktop.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('greeting reads a Unicode name, blocks at requests, and resumes', async ({ page }) => {
  const errors = await open(page);
  await example(page, 'greeting');
  await run(page, 'Waiting for input');
  await expect(page.locator('#console-output')).toHaveText('What is your name? ');
  const tick = await page.locator('#tick').textContent();
  await page.locator('#phase-step').click();
  await expect(page.locator('#tick')).toHaveText(tick!);
  await page.locator('#console-input').fill('Ada 🌍');
  await page.locator('#send-input').click();
  await run(page);
  await expect(page.locator('#console-output')).toHaveText('What is your name? Greetings, Ada 🌍\n');
  await expect(page.locator('#console-input')).toBeDisabled();
  expect(errors).toEqual([]);
});

test('mobile layout, source editing, and compile errors remain usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = await open(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.locator('#source').fill('fn main() { return 1; }');
  await page.locator('#compile').click();
  await run(page);
  await expect(page.locator('#led-text')).toContainText('(1)');
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
  await page.locator('#source').fill('fn main( {');
  await page.locator('#compile').click();
  await expect(page.locator('#error')).toBeVisible();
  await expect(page.locator('#run')).toBeDisabled();
  expect(errors).toEqual([]);
});

test('matrix and vector lead the page; every 6x6 coefficient is inspectable and exportable', async ({ page }) => {
  const errors = await open(page);
  await expect(page.locator('#dimensions')).toHaveText('6 × 6');
  await expect(page.locator('.preset-strip #example')).toBeVisible();
  await expect(page.locator('.preset-strip #parameters')).toBeVisible();
  await expect(page.locator('.preset-strip')).not.toContainText('nullnull');
  await expect(page.locator('#coefficient-table')).toBeVisible();
  await expect(page.locator('#vector-view')).toBeVisible();
  await expect(page.locator('#coefficient-table button')).toHaveCount(36);
  await expect(page.locator('#vector-body tr')).toHaveCount(6);
  const positions = await page.evaluate(() => ({ matrix: document.querySelector('#math-overview')!.getBoundingClientRect().top, source: document.querySelector('.source-panel')!.getBoundingClientRect().top, ports: document.querySelector('.outputs')!.getBoundingClientRect().top, detail: document.querySelector('.detail-panel')!.getBoundingClientRect().top }));
  expect(positions.matrix).toBeLessThan(positions.ports); expect(positions.ports).toBeLessThan(positions.source); expect(positions.ports).toBeLessThan(positions.detail);
  await page.getByRole('button', { name: 'W[0, 5] = -2', exact: true }).click();
  await expect(page.locator('#matrix-cell-detail')).toContainText('W[0, 5] = -2');
  await expect(page.locator('#row-name')).toContainText('[0]');
  await page.getByRole('button', { name: 'W[0, 1] = 0', exact: true }).click();
  await expect(page.locator('#matrix-cell-detail')).toContainText('W[0, 1] = 0');
  await page.locator('#matrix-register-search').fill('constant.1');
  await page.locator('#matrix-register-matches').getByRole('button', { name: 'Go to column' }).click();
  await expect(page.locator('#matrix-cell-detail')).toContainText('source: constant.1');
  const jsonDownload = page.waitForEvent('download'); await page.locator('#matrix-export-json').click();
  const json = JSON.parse(await readFile(await (await jsonDownload).path() as string, 'utf8'));
  expect(json.shape).toEqual([6, 6]); expect(json.rows[0]).toEqual({ cols: [0, 5], weights: [1, -2] });
  expect(json.registers).toHaveLength(6);
  const csvDownload = page.waitForEvent('download'); await page.locator('#matrix-export-csv').click();
  const csv = await readFile(await (await csvDownload).path() as string, 'utf8');
  expect(csv).toContain('0,5,-2,'); expect(csv.trim().split('\n')).toHaveLength(11);
  await expect(page.locator('#tick')).toHaveText('0');
  expect(errors).toEqual([]);
});

test('large matrices use bounded windows and presets enable only linked devices', async ({ page }) => {
  const errors = await open(page);
  for (const [id, output, input, screen] of [['hello', true, false, true], ['greeting', true, true, false], ['parity', false, false, false]] as const) {
    await example(page, id);
    expect(await page.locator('#enable-output').isChecked()).toBe(output);
    expect(await page.locator('#enable-input').isChecked()).toBe(input);
    expect(await page.locator('#enable-screen').isChecked()).toBe(screen);
  }
  await example(page, 'greeting');
  const n = Number((await page.locator('#dimensions').textContent())!.split('×')[0].trim().replaceAll(',', ''));
  expect(n).toBeGreaterThan(100);
  expect(await page.locator('#coefficient-table button').count()).toBeLessThanOrEqual(144);
  await page.locator('#matrix-row-start').fill(String(n - 1));
  await page.locator('#matrix-column-start').fill(String(n - 1));
  await page.getByRole('button', { name: 'Go to block' }).click();
  await expect(page.locator('#coefficient-table button')).toHaveCount(1);
  await expect(page.locator('#matrix-range')).toContainText(`Rows ${n - 1}–${n - 1}`);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: 'test-results/matrix-inspection-mobile.png', fullPage: true });
  expect(errors).toEqual([]);
});
