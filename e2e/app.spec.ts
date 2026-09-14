import { test, expect } from '@playwright/test';
import { setup, task, move } from './helpers';
test('empty first run, keyboard capture, lifecycle and persistence', async ({
  page,
}) => {
  await setup(page);
  await task(page, 'Ship release');
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Ship release', exact: true }),
  ).toBeVisible();
  await move(page, 'Ship release', 'Working');
  await move(page, 'Ship release', 'Done');
  await move(page, 'Ship release', 'Inbox');
  await move(page, 'Ship release', 'Done');
  await page.getByRole('button', { name: 'Ship release', exact: true }).click();
  await expect(page.locator('dd').first()).not.toHaveText('Not started');
  await page.getByText(/History ·/).click();
  await expect(
    page.locator('.history strong').filter({ hasText: 'reopened' }),
  ).toHaveCount(1);
  await expect(
    page.locator('.history strong').filter({ hasText: 'completed' }),
  ).toHaveCount(2);
  await page
    .getByLabel('Description', { exact: true })
    .fill('N / are text, not shortcuts');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.inspector .save-state').last()).toHaveText(
    'Saved',
  );
  await page.reload();
  await page.getByRole('button', { name: 'Ship release', exact: true }).click();
  await expect(page.getByLabel('Description', { exact: true })).toHaveValue(
    'N / are text, not shortcuts',
  );
});
test('project cloning, progress and completion confirmation', async ({
  page,
}) => {
  await setup(page);
  await page.keyboard.press('Shift+N');
  await page.getByLabel('Title', { exact: true }).fill('Launch project');
  await page
    .getByRole('button', { name: 'Create project', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Launch project', exact: true })
    .click();
  await task(page, 'First child');
  await task(page, 'Second child');
  await move(page, 'First child', 'Done');
  await expect(page.getByText('1/2 tasks complete')).toBeVisible();
  await page.getByRole('button', { name: 'Edit details' }).click();
  page.once('dialog', (d) => d.accept());
  await page
    .locator('.inspector')
    .getByLabel('Move to…')
    .selectOption({ label: 'Done' });
  await expect(page.locator('.inspector dd').last()).not.toHaveText(
    'Not complete',
  );
  await expect(page.getByText('1/2 tasks complete')).toBeVisible();
});
test('archive restore and permanent delete confirmation', async ({ page }) => {
  await setup(page);
  await task(page, 'Archive me');
  await move(page, 'Archive me', 'Done');
  await page.getByRole('button', { name: 'Archive me', exact: true }).click();
  await page.getByText('Archive & deletion').click();
  await page
    .locator('.inspector')
    .getByRole('button', { name: 'Archive', exact: true })
    .click();
  await page.getByRole('link', { name: 'Archive', exact: true }).click();
  await expect(page.getByText('Archive me', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(page.getByText('No archived work')).toBeVisible();
  await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
  await page.getByRole('button', { name: 'Archive me', exact: true }).click();
  await page.getByText('Archive & deletion').click();
  page.once('dialog', (d) => d.dismiss());
  await page.getByRole('button', { name: 'Delete permanently…' }).click();
  await expect(
    page.getByRole('button', { name: 'Archive me', exact: true }),
  ).toBeVisible();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Delete permanently…' }).click();
  await expect(
    page.getByRole('button', { name: 'Archive me', exact: true }),
  ).toHaveCount(0);
});
test('JSON and encrypted backup round trips with replacement preview', async ({
  page,
}) => {
  await setup(page);
  await task(page, 'Backup work');
  await page.getByLabel('Scratchpad').fill('Remember this');
  await expect(page.locator('.scratchpad .save-state')).toHaveText('Saved');
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export JSON', exact: true }).click();
  const file = await downloaded;
  const path = await file.path();
  await page.getByLabel('Backup file').setInputFiles(path!);
  await expect(page.getByRole('dialog')).toContainText('1 items');
  await page.getByRole('button', { name: 'Confirm replace all data' }).click();
  await expect(
    page.getByText('Import completed', { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel('Backup passphrase')
    .fill('correct horse battery staple');
  const encrypted = page.waitForEvent('download');
  await page
    .getByRole('button', { name: 'Export encrypted', exact: true })
    .click();
  const encryptedPath = await (await encrypted).path();
  await page
    .getByLabel('Backup passphrase')
    .fill('correct horse battery staple');
  await page.getByLabel('Backup file').setInputFiles(encryptedPath!);
  await page.getByRole('button', { name: 'Confirm replace all data' }).click();
  await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Backup work', exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Scratchpad')).toHaveValue('Remember this');
});
test('cached shell and IndexedDB work offline', async ({ page, context }) => {
  await setup(page);
  await task(page, 'Offline work');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Offline work', exact: true }),
  ).toBeVisible();
  await task(page, 'Created offline');
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Created offline', exact: true }),
  ).toBeVisible();
});
test('calendar planned and timeline modes remain local', async ({ page }) => {
  await setup(page);
  await task(page, 'Plan work');
  await page.getByRole('button', { name: 'Plan work', exact: true }).click();
  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-15`;
  await page.getByLabel('Planned start').fill(date);
  await page.getByRole('link', { name: 'Calendar', exact: true }).click();
  await page.getByLabel('Top-level tasks', { exact: true }).click();
  await expect(
    page.getByLabel('Top-level tasks', { exact: true }),
  ).toBeChecked();
  await page.getByLabel('Calendar mode').selectOption('planned');
  await expect(page.getByRole('button', { name: /Plan work/ })).toBeVisible();
  await page.getByLabel('Calendar view').selectOption('timeline');
  await page.getByLabel('Calendar mode').selectOption('compare');
  await expect(
    page.getByText('Planned · no end date · open-ended'),
  ).toBeVisible();
});
test('column safety, manual order, and desktop / mobile presentation', async ({
  page,
}) => {
  await setup(page);
  await task(page, 'First task');
  await task(page, 'Second task');
  const second = page.locator('article').filter({
    has: page.getByRole('button', { name: 'Second task', exact: true }),
  });
  await second.locator('summary').click();
  await second.getByRole('button', { name: 'Move up', exact: true }).click();
  await expect(page.locator('.card-title').first()).toHaveText('Second task');
  await page
    .getByRole('button', { name: 'Configure Working', exact: true })
    .click();
  await page.getByRole('button', { name: 'Move left', exact: true }).click();
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(page.locator('.column-header h2').first()).toHaveText('Working');
  await page
    .getByRole('button', { name: 'Configure Inbox', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Delete column…', exact: true })
    .click();
  await page
    .getByLabel('Destination / replacement default')
    .selectOption({ label: 'Working' });
  await page
    .getByRole('button', { name: 'Confirm delete column', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    page.getByRole('region', { name: 'Working column' }).locator('article'),
  ).toHaveCount(2);
  await page.screenshot({
    path: 'test-results/desktop-board.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'First task', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: 'Item details' }),
  ).toBeVisible();
  await page.screenshot({
    path: 'test-results/mobile-inspector.png',
    fullPage: true,
  });
});
