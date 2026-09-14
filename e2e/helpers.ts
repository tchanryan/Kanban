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
export async function task(page: Page, title: string, columnName = 'Inbox') {
  await page.getByLabel(`New task in ${columnName}`).fill(title);
  await page.getByLabel(`New task in ${columnName}`).press('Enter');
  await expect(
    page.getByRole('button', { name: title, exact: true }),
  ).toBeVisible();
}
export async function move(page: Page, title: string, columnName: string) {
  await page.getByRole('button', { name: title, exact: true }).click();
  await page
    .locator('.inspector')
    .getByLabel('Move to…')
    .selectOption({ label: columnName });
  await page.getByRole('button', { name: 'Close details' }).click();
}
export async function confirm(page: Page, accept = true) {
  const dialog = page.locator('.confirmation-dialog');
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole('button', {
      name: accept ? /^(Confirm|Continue)$/ : 'Cancel',
      exact: true,
    })
    .click();
}
