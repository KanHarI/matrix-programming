import { expect, test, type Page } from '@playwright/test';
import { choosePreset, showTab } from './navigation';

async function open(page: Page): Promise<void> {
  await page.goto('/?preset=parity');
  await expect(page.locator('#backend')).toContainText('WASM');
  await expect(page.locator('#app-panel-run')).toBeVisible();
}
function pythonList(text: string): unknown {
  expect(text).toMatch(/^[\s\[\],\d-]+$/);
  return JSON.parse(text.replace(/,\s*]/g, ']'));
}
async function copy(page: Page, selector: string): Promise<unknown> {
  await page.locator(selector).click();
  await expect(page.locator('#copy-feedback')).toContainText(/copied/i);
  return pythonList(await page.evaluate(() => navigator.clipboard.readText()));
}

test('tabs separate presets, editing, execution and inspection without duplicate controls', async ({ page }) => {
  await open(page);
  for (const tab of ['presets', 'program', 'run', 'inspect']) {
    await expect(page.locator(`#app-tab-${tab}`)).toHaveAttribute('role', 'tab');
    await expect(page.locator(`#app-tab-${tab}`)).toHaveAttribute('aria-controls', `app-panel-${tab}`);
  }
  await expect(page.locator('#app-tab-run')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#source')).toBeHidden();
  await expect(page.locator('#example')).toBeHidden();
  await expect(page.locator('#coefficient-table')).toBeHidden();
  await expect(page.locator('#math-overview')).toBeVisible();
  await page.locator('#step').evaluate(element => element.setAttribute('data-identity-test', 'same-toolbar'));
  await showTab(page, 'program');
  await expect(page.locator('#source')).toBeVisible();
  await page.locator('#source').evaluate(element => element.setAttribute('data-identity-test', 'same-source'));
  const edited = `${await page.locator('#source').inputValue()}\n// Shared source survives tab changes.\n`;
  await page.locator('#source').fill(edited);
  await showTab(page, 'inspect');
  await expect(page.locator('#source')).toBeVisible();
  await expect(page.locator('#source')).toHaveValue(edited);
  await expect(page.locator('#source')).toHaveAttribute('data-identity-test', 'same-source');
  await expect(page.locator('#matrix-logical-rows')).toBeVisible();
  await expect(page.locator('#coefficient-table')).toBeHidden();
  await expect(page.locator('#vector-view')).toBeVisible();
  await expect(page.locator('#math-overview')).toBeHidden();
  await expect(page.locator('.outputs')).toBeHidden();
  await expect(page.locator('#step')).toHaveAttribute('data-identity-test', 'same-toolbar');
  await expect(page.locator('#step')).toBeDisabled();
  await showTab(page, 'program');
  await expect(page.locator('#source')).toHaveValue(edited);
  for (const id of ['source', 'parameters', 'step', 'compile']) await expect(page.locator(`#${id}`)).toHaveCount(1);
  await expect(page.locator('#tick')).toHaveText('0');
  await page.locator('#app-tab-program').focus();
  await page.locator('#app-tab-program').press('ArrowRight');
  await expect(page.locator('#app-tab-run')).toBeFocused();
  await expect(page.locator('#app-panel-run')).toBeVisible();
  await page.locator('#app-tab-run').press('Home');
  await expect(page.locator('#app-tab-presets')).toBeFocused();
  await expect(page.locator('#app-panel-presets')).toBeVisible();
});

test('the shared program name follows source identity across tabs, not numeric input values', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#backend')).toContainText('WASM');
  const name = page.locator('#active-program-name');
  const origin = page.locator('#program-origin');
  const parityName = (await page.locator('#example option:checked').textContent())!;
  const originalSource = await page.locator('#source').inputValue();
  const tabs = ['presets', 'program', 'inspect', 'run'] as const;
  for (const tab of tabs) {
    await showTab(page, tab);
    await expect(name).toBeVisible();
    await expect(name).toHaveText(parityName);
    await expect(origin).toHaveText('Preset');
  }
  await page.locator('[data-parameter="n"]').fill('9');
  await expect(name).toHaveText(parityName);
  await showTab(page, 'program');
  await page.locator('#source').fill(`${originalSource}\n// An edited program.\n`);
  for (const tab of tabs) {
    await showTab(page, tab);
    await expect(name).toBeVisible();
    await expect(name).toHaveText('Custom program');
    await expect(origin).toHaveText('Edited source');
  }
  await showTab(page, 'program');
  await page.locator('#source').fill(originalSource);
  await expect(name).toHaveText(parityName);
  await expect(origin).toHaveText('Preset');
  await choosePreset(page, 'recursive-factorial');
  await expect(name).toHaveText('Recursive factorial');
  await page.locator('[data-parameter="n"]').fill('6');
  for (const tab of tabs) {
    await showTab(page, tab);
    await expect(name).toBeVisible();
    await expect(name).toHaveText('Recursive factorial');
    await expect(origin).toHaveText('Preset');
  }
});

test('preset choice opens Run paused, while mathematical row clicks open Inspect', async ({ page }) => {
  await open(page);
  await choosePreset(page, 'prime-simple');
  await expect(page.locator('#app-tab-run')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#tick')).toHaveText('0');
  await expect(page.locator('#status')).toHaveText('Paused');
  await page.locator('.math-current-vector [data-row="0"]').click();
  await expect(page.locator('#app-panel-inspect')).toBeVisible();
  await expect(page.locator('#row-name')).toContainText('[0]');
  await expect(page.locator('#source')).toBeVisible();
  await expect(page.locator('#tick')).toHaveText('0');
});

test('tab changes preserve an active run and its committed state', async ({ page }) => {
  await open(page);
  await page.locator('[data-parameter="n"]').fill('4294967295');
  await page.locator('#run').click();
  await expect(page.locator('#status')).toHaveText('Running');
  const tick = Number((await page.locator('#tick').textContent())!.replaceAll(',', ''));
  await showTab(page, 'presets');
  await expect.poll(async () => Number((await page.locator('#tick').textContent())!.replaceAll(',', ''))).toBeGreaterThan(tick);
  await showTab(page, 'program');
  await showTab(page, 'inspect');
  await expect(page.locator('#run')).toHaveText('Ⅱ Pause');
  await expect(page.locator('#status')).toHaveText('Running');
  await page.locator('#run').click();
  const stopped = await page.locator('#tick').textContent();
  await showTab(page, 'run');
  await expect(page.locator('#status')).toHaveText('Paused');
  await expect(page.locator('#tick')).toHaveText(stopped!);
});

test('copy exports the complete Python matrix and only committed vector values', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await open(page);
  const expected = [
    [1, 0, 0, 0, 0, -2], [-1, 0, 0, 0, 0, 1], [-1, 0, 0, 0, 0, 2],
    [0, 1, 0, 0, 0, 0], [0, -1, 1, 0, 0, 0], [0, 0, 0, 0, 0, 1],
  ];
  expect(await copy(page, '#copy-matrix-python')).toEqual(expected);
  const initial = [42, 0, 0, 0, 0, 1];
  expect(await copy(page, '#copy-input-vector')).toEqual(initial);
  await page.locator('#phase-step').click();
  await page.locator('#phase-step').click();
  await expect(page.locator('#phase-step')).toHaveText('Commit tick →');
  expect(await copy(page, '#copy-input-vector')).toEqual(initial);
  await showTab(page, 'inspect');
  expect(await copy(page, '#copy-matrix-python')).toEqual(expected);
  expect(await copy(page, '#copy-input-vector')).toEqual(initial);
  await page.locator('#phase-step').click();
  expect(await copy(page, '#copy-input-vector')).toEqual([40, 0, 0, 0, 0, 1]);
  await expect(page.locator('#tick')).toHaveText('1');
});

test('copying a large matrix exports every row and column, not the displayed excerpt', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await open(page);
  await choosePreset(page, 'prime-simple');
  const n = Number((await page.locator('#dimensions').textContent())!.split('×')[0].trim().replaceAll(',', ''));
  expect(n).toBeGreaterThan(8);
  const matrix = await copy(page, '#copy-matrix-python') as number[][];
  expect(matrix).toHaveLength(n);
  for (const row of matrix) { expect(row).toHaveLength(n); expect(row.every(Number.isInteger)).toBe(true); }
  expect(matrix.flat().some(value => value < 0)).toBe(true);
  const vector = await copy(page, '#copy-input-vector') as number[];
  expect(vector).toHaveLength(n);
  expect(vector.every(value => Number.isInteger(value) && value >= 0)).toBe(true);
  await expect(page.locator('#tick')).toHaveText('0');
});

test('clipboard denial provides exact selectable text instead of claiming success', async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async () => { throw new DOMException('Clipboard denied in regression test', 'NotAllowedError'); } },
    });
  });
  await page.locator('#copy-input-vector').click();
  await expect(page.locator('#copy-dialog')).toBeVisible();
  await expect(page.locator('#copy-feedback')).toContainText('Clipboard unavailable');
  const field = page.locator('#copy-manual-text');
  expect(pythonList(await field.inputValue())).toEqual([42, 0, 0, 0, 0, 1]);
  await expect(field).toHaveAttribute('readonly', '');
  const selection = await field.evaluate((element: HTMLTextAreaElement) => [element.selectionStart, element.selectionEnd, element.value.length]);
  expect(selection).toEqual([0, selection[2], selection[2]]);
  await page.locator('#copy-dialog').getByRole('button', { name: 'Close' }).click();
  await expect(page.locator('#copy-dialog')).toBeHidden();
  await expect(page.locator('#tick')).toHaveText('0');
});

test('mobile tabs keep their active content and copy controls inside the page', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await open(page);
  for (const tab of ['presets', 'program', 'inspect', 'run'] as const) {
    await showTab(page, tab);
    expect(await page.evaluate(() => document.documentElement.scrollWidth), tab).toBeLessThanOrEqual(320);
    await expect(page.locator(`#app-tab-${tab}`)).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[role="tabpanel"]:visible')).toHaveCount(1);
    if (tab === 'inspect' || tab === 'run') {
      for (const id of ['copy-matrix-python', 'copy-input-vector']) {
        await expect(page.locator(`#${id}`)).toBeVisible();
        const bounds = await page.locator(`#${id}`).boundingBox();
        expect(bounds!.x).toBeGreaterThanOrEqual(0);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
      }
    }
  }
  await page.screenshot({ path: 'test-results/tabs-mobile.png', fullPage: true });
});
