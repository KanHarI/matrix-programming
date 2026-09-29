import { expect, test, type Page } from '@playwright/test';

async function open(page: Page, hash = '') {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`/tour.html${hash}`);
  await expect(page.locator('.t-step')).toHaveCount(await page.evaluate(() => new URLSearchParams(location.search).get('tour') === 'clock') ? 7 : 20);
  return errors;
}
const activeChapter = (page: Page) => page.locator('.t-step.t-active');
const visibleScene = (page: Page) => page.locator('.t-scene.t-visible');

test('the tour opens on its first chapter and moves chapter by chapter', async ({ page }) => {
  const errors = await open(page);
  await expect(activeChapter(page)).toHaveAttribute('id', 'intro');
  await expect(visibleScene(page)).toHaveAttribute('data-scene', 'hero');
  await expect(visibleScene(page)).toContainText('Parity of 4');
  await page.keyboard.press('ArrowRight');
  await expect(activeChapter(page)).toHaveAttribute('id', 'state');
  await expect(visibleScene(page)).toHaveAttribute('data-scene', 'state');
  await expect(page).toHaveURL(/#state$/);
  await page.locator('.t-segment').nth(8).click();
  await expect(activeChapter(page)).toHaveAttribute('id', 'control');
  await expect(visibleScene(page)).toContainText('Program counter');
  await page.mouse.move(700, 500);
  await page.mouse.wheel(0, -2400);
  await expect(activeChapter(page)).not.toHaveAttribute('id', 'control');
  expect(errors).toEqual([]);
});

test('chapters animate real computations and accept input', async ({ page }) => {
  const errors = await open(page, '#commit');
  await expect(activeChapter(page)).toHaveAttribute('id', 'commit');
  await expect(visibleScene(page)).toHaveAttribute('data-scene', 'loop');
  await page.getByRole('button', { name: 'n = 7' }).click();
  await expect(page.getByRole('button', { name: 'n = 7' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#loop-result')).toHaveText('n = 7: odd, after 5 ticks.', { timeout: 30_000 });
  await page.locator('.t-segment').nth(3).click();
  await expect(visibleScene(page)).toHaveAttribute('data-scene', 'multiply');
  await expect(visibleScene(page).locator('.t-formula')).toContainText('= −3', { timeout: 10_000 });
  expect(errors).toEqual([]);
});

test('Play advances chapters like a movie and Space pauses it', async ({ page }) => {
  const errors = await open(page, '#relu');
  await expect(activeChapter(page)).toHaveAttribute('id', 'relu');
  await page.locator('.t-play').click();
  await expect(page.locator('.t-play')).toHaveAttribute('aria-pressed', 'true');
  await expect(activeChapter(page)).toHaveAttribute('id', 'commit', { timeout: 20_000 });
  await page.keyboard.press('Space');
  await expect(page.locator('.t-play')).toHaveAttribute('aria-pressed', 'false');
  await page.waitForTimeout(15_000);
  await expect(activeChapter(page)).toHaveAttribute('id', 'commit');
  expect(errors).toEqual([]);
});

test('the lab links to the tour, and the tour links back', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: /Take the tour/ }).click();
  await expect(page).toHaveURL(/tour\.html/);
  await page.locator('.t-segment').last().click();
  await expect(visibleScene(page)).toHaveAttribute('data-scene', 'outro');
  await page.getByRole('link', { name: 'Start with parity' }).click();
  await expect(page.locator('#app-panel-run')).toBeVisible();
  await expect(page.locator('#dimensions')).toHaveText('6 × 6');
});

test('the 11-phase clock is a side tour, reached from control flow and leading back', async ({ page }) => {
  const errors = await open(page, '#control');
  await expect(page.locator('.t-step')).toHaveCount(20);
  await expect(page.locator('#clock-ring')).toHaveCount(0);
  await page.getByRole('link', { name: /How the 11-phase clock works/ }).click();
  await expect(page).toHaveURL(/tour=clock/);
  await expect(page.locator('.t-step')).toHaveCount(7);
  await expect(page.locator('.t-brand-sub')).toHaveText('Side tour');
  await expect(activeChapter(page)).toHaveAttribute('id', 'clock-intro');
  await page.locator('.t-segment').nth(3).click();
  await expect(activeChapter(page)).toHaveAttribute('id', 'clock-phases');
  await expect(page).toHaveURL(/tour=clock#clock-phases$/);
  // Phase 7 of `let t = a + b;` on the third iteration: a = 1, b = 2.
  await expect(visibleScene(page).locator('.t-live-coordinates')).toContainText('ALU = 3', { timeout: 20_000 });
  await page.locator('.t-segment').last().click();
  await page.getByRole('link', { name: 'Continue the main tour' }).click();
  await expect(page.locator('.t-step')).toHaveCount(20);
  await expect(activeChapter(page)).toHaveAttribute('id', 'lab-presets');
  expect(errors).toEqual([]);
});

test('Next moves at the viewer’s pace, from the header, the chapter, or repeated presses', async ({ page }) => {
  const errors = await open(page);
  await expect(page.getByRole('button', { name: 'Previous chapter' })).toBeDisabled();
  await page.getByRole('button', { name: 'Next chapter' }).click();
  await expect(activeChapter(page)).toHaveAttribute('id', 'state');
  await activeChapter(page).getByRole('button', { name: /Next.*The program is the matrix W/ }).click();
  await expect(activeChapter(page)).toHaveAttribute('id', 'matrix');
  // Three quick presses advance three chapters, even while the first scroll is still moving.
  for (let press = 0; press < 3; press++) await page.getByRole('button', { name: 'Next chapter' }).click();
  await expect(activeChapter(page)).toHaveAttribute('id', 'commit');
  await page.getByRole('button', { name: 'Previous chapter' }).click();
  await expect(activeChapter(page)).toHaveAttribute('id', 'relu');
  // During Play, Next skips ahead without stopping playback.
  await page.locator('.t-play').click();
  await page.getByRole('button', { name: 'Next chapter' }).click();
  await expect(activeChapter(page)).toHaveAttribute('id', 'commit');
  await expect(page.locator('.t-play')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.t-segment').last().click();
  await expect(page.getByRole('button', { name: 'Next chapter' })).toBeDisabled();
  expect(errors).toEqual([]);
});

test('the Inspect chapters walk through each part of the tab with real data', async ({ page }) => {
  const errors = await open(page, '#inspect-layout');
  const scene = visibleScene(page);
  await expect(scene).toHaveAttribute('data-scene', 'inspect');
  await expect(scene).toContainText('Compiled instructions');
  await page.getByRole('button', { name: 'Next chapter' }).click();
  await expect(activeChapter(page)).toHaveAttribute('id', 'inspect-matrix');
  await expect(scene).toContainText('"[5] const_1": { }');
  await page.getByRole('button', { name: 'Next chapter' }).click();
  await expect(scene.locator('.t-app-table .t-negative').first()).toHaveText('−3', { timeout: 10_000 });
  await page.getByRole('button', { name: 'Next chapter' }).click();
  await expect(scene).toContainText('Sum = −3 → ReLU = max(0, −3) = 0');
  await page.getByRole('button', { name: 'Next chapter' }).click();
  await expect(scene.locator('.t-app-badge')).not.toHaveClass(/t-hidden/, { timeout: 15_000 });
  await expect(scene.locator('.t-app-badge')).toHaveText('Breakpoint · line 7');
  await page.getByRole('button', { name: 'Next chapter' }).click();
  await expect(activeChapter(page)).toHaveAttribute('id', 'inspect-history');
  await expect(scene).toContainText('Register main.alu exceeds its 4294967295 bound (4294967297)');
  await expect(scene).toContainText('below_1 0→1, below_2 0→2');
  await expect(scene.locator('.t-app-overflow')).toBeVisible({ timeout: 15_000 });
  await expect(scene.locator('.t-app-overflow')).toContainText('by 2.');
  expect(errors).toEqual([]);
});

test('the tour fits a phone screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = await open(page, '#lab-run');
  await expect(visibleScene(page)).toHaveAttribute('data-scene', 'lab');
  await expect(page.locator('.t-stage')).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  expect(errors).toEqual([]);
});
