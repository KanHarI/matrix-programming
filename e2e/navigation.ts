import { expect, type Page } from '@playwright/test';

export type AppTab = 'presets' | 'program' | 'run' | 'inspect';
export async function showTab(page: Page, tab: AppTab): Promise<void> {
  await page.locator(`#app-tab-${tab}`).click();
  await expect(page.locator(`#app-panel-${tab}`)).toBeVisible();
}
export async function choosePreset(page: Page, preset: string): Promise<void> {
  await showTab(page, 'presets');
  await page.locator('#example').selectOption(preset);
  await expect(page.locator('#app-panel-run')).toBeVisible();
}
export async function editSource(page: Page, source: string): Promise<void> {
  await showTab(page, 'program');
  await page.locator('#source').fill(source);
}
export async function compileProgram(page: Page): Promise<void> {
  await showTab(page, 'program');
  await page.locator('#compile').click();
  if (await page.locator('#error').getAttribute('hidden') !== null) await showTab(page, 'run');
}
export async function setDevice(page: Page, name: 'led' | 'screen' | 'input' | 'output', enabled: boolean): Promise<void> {
  await showTab(page, 'inspect');
  const details = page.locator('.device-config');
  if (!(await details.evaluate(element => (element as HTMLDetailsElement).open))) await details.locator('summary').click();
  await page.locator(`#enable-${name}`).setChecked(enabled);
  await showTab(page, 'run');
}
