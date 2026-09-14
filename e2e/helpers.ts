import { expect, type Page } from '@playwright/test';
export async function column(page: Page, name: string, flag?: string) {
  await page.getByRole('button', { name: 'Column', exact: true }).click();
  await page.getByLabel('Column name').fill(name);
  if (flag) await page.getByLabel(flag).check();
  await page
    .getByRole('button', { name: 'Create column', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
export async function setup(page: Page) {
  await page.goto('./');
  await expect(page.getByText('Your workflow starts here')).toBeVisible();
  await column(page, 'Inbox');
  await column(page, 'Working', 'Start work on first entry');
  await column(page, 'Done', 'Complete items on entry');
}
export async function task(page: Page, title: string) {
  await page.getByLabel('New task in Inbox').fill(title);
  await page.getByLabel('New task in Inbox').press('Enter');
  await expect(
    page.getByRole('button', { name: title, exact: true }),
  ).toBeVisible();
}
export async function move(page: Page, title: string, columnName: string) {
  const card = page
    .locator('article')
    .filter({ has: page.getByRole('button', { name: title, exact: true }) });
  await card.locator('summary').click();
  await card
    .getByLabel(`Move ${title} to`, { exact: true })
    .selectOption({ label: columnName });
}
