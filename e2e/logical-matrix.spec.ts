import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { choosePreset, showTab } from './navigation';

test('logical rows toggle diagonal defaults without changing coefficients or execution', async ({ page }) => {
  await page.goto('/');
  await showTab(page, 'inspect');
  await expect(page.locator('#matrix-view-logical')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#matrix-view-grid')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#matrix-diagonal-default')).toBeChecked();
  await expect(page.locator('#coefficient-table')).toBeHidden();
  await expect(page.locator('.matrix-logical-row')).toHaveCount(6);
  await expect(page.locator('.logical-coefficient')).toHaveCount(12);
  await expect(page.locator('.logical-coefficient[data-row="0"][data-column="0"]')).toHaveCount(0);
  await expect(page.locator('.logical-coefficient[data-row="1"][data-column="1"]')).toHaveAttribute('data-weight', '0');
  await expect(page.locator('.matrix-logical-row[data-row="5"]')).toContainText('{  }');
  await page.locator('.logical-coefficient[data-row="1"][data-column="1"]').click();
  await expect(page.locator('#matrix-cell-detail')).toContainText('W[1, 1] = 0');
  await expect(page.locator('#row-name')).toContainText('[1]');
  await page.locator('#matrix-diagonal-default').uncheck();
  await expect(page.locator('#matrix-logical-help')).toContainText('diagonal 0, off-diagonal 0');
  await expect(page.locator('.logical-coefficient')).toHaveCount(10);
  await expect(page.locator('.logical-coefficient[data-row="0"][data-column="0"]')).toHaveAttribute('data-weight', '1');
  await expect(page.locator('.logical-coefficient[data-row="1"][data-column="1"]')).toHaveCount(0);
  await page.locator('.logical-coefficient[data-row="0"][data-column="5"]').click();
  await expect(page.locator('#matrix-cell-detail')).toContainText('W[0, 5] = -2');
  await expect(page.locator('#tick')).toHaveText('0');
  await expect(page.locator('#dimensions')).toHaveText('6 × 6');
  await page.locator('#matrix-view-grid').click();
  await expect(page.locator('#coefficient-table button')).toHaveCount(36);
  await expect(page.locator('#matrix-diagonal-default')).toBeHidden();
  await expect(page.locator('#matrix-cell-detail')).toContainText('W[0, 5] = -2');
});

test('logical rows include source columns outside the grid window and stay usable on mobile', async ({ page }) => {
  await page.goto('/?preset=prime-simple');
  await showTab(page, 'inspect');
  const download = page.waitForEvent('download'); await page.locator('#matrix-export-json').click();
  const artifact = JSON.parse(await readFile(await (await download).path() as string, 'utf8')) as {
    rows: { cols: number[]; weights: number[] }[];
  };
  await page.locator('#matrix-view-logical').click();
  await expect(page.locator('.matrix-logical-row')).toHaveCount(12);
  const terms = await page.locator('.logical-coefficient').evaluateAll(elements => elements.map(element => {
    const { row, column, weight } = (element as HTMLElement).dataset;
    return { row: Number(row), column: Number(column), weight: Number(weight) };
  }));
  expect(terms.some(term => term.column >= 12)).toBe(true);
  for (let row = 0; row < 12; row++) for (let column = 0; column < artifact.rows.length; column++) {
    const actual = terms.find(term => term.row === row && term.column === column)?.weight ?? (row === column ? 1 : 0);
    const sparse = artifact.rows[row]!;
    expect(actual).toBe(sparse.cols.reduce((sum, col, i) => sum + (col === column ? sparse.weights[i]! : 0), 0));
  }
  await page.getByRole('button', { name: 'Next matrix rows' }).click();
  await expect(page.locator('#matrix-range')).toContainText('Rows 12–23');
  await choosePreset(page, 'parity');
  await showTab(page, 'inspect');
  await expect(page.locator('.matrix-logical-row')).toHaveCount(6);
  await expect(page.locator('#matrix-range')).toContainText('Rows 0–5');
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await expect(page.locator('#matrix-diagonal-default')).toBeVisible();
  }
  await page.locator('#matrix-inspector').screenshot({ path: 'test-results/logical-matrix-mobile.png' });
});

test('dense logical rows paginate coefficients explicitly without dropping access to any term', async ({ page }) => {
  await page.goto('/');
  // Isolate the real inspector component with a synthetic dense row. Compiled
  // presets are sparse, so they do not otherwise exercise term pagination.
  await page.evaluate(async () => {
    const modulePath = '/src/matrix-inspector.ts';
    const { MatrixInspector } = await import(modulePath);
    const root = document.createElement('section'); root.id = 'dense-fixture';
    document.body.replaceChildren(root);
    const columns = Array.from({ length: 130 }, (_, i) => i);
    new MatrixInspector(root, () => {}).setArtifact({
      rows: columns.map(row => row === 0 ? { cols: columns, weights: columns.map(() => 2) } : { cols: [], weights: [] }),
      registers: columns.map(i => ({ name: `register.${i}` })),
    });
  });
  await page.locator('#matrix-view-logical').click();
  const row = page.locator('.matrix-logical-row[data-row="0"]');
  await expect(row.locator('.logical-coefficient')).toHaveCount(64);
  await expect(row).toContainText('Partial row: overrides 1–64 of 130');
  await page.getByRole('button', { name: 'Next terms for row 0', exact: true }).click();
  await expect(row).toContainText('overrides 65–128 of 130');
  await row.locator('.logical-coefficient[data-column="64"]').click();
  await expect(page.locator('#matrix-cell-detail')).toContainText('W[0, 64] = 2');
  await page.getByRole('button', { name: 'Next terms for row 0', exact: true }).click();
  await expect(row.locator('.logical-coefficient')).toHaveCount(2);
  await expect(row).toContainText('overrides 129–130 of 130');
  await expect(page.getByRole('button', { name: 'Next terms for row 0', exact: true })).toBeDisabled();
  await page.locator('#matrix-diagonal-default').uncheck();
  await expect(row).toContainText('overrides 1–64 of 130');
});
