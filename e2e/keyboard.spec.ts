import { test, expect } from '@playwright/test';
import { setup, task } from './helpers';

test('keyboard capture, details and search restore usable focus', async ({
  page,
}) => {
  await setup(page);
  const columnButton = page.getByRole('button', {
    name: 'Column',
    exact: true,
  });
  await columnButton.focus();
  await page.keyboard.press('n');
  const dialog = page.getByRole('dialog', { name: 'New task', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Title', { exact: true })).toBeFocused();
  await page.keyboard.type('Keyboard task');
  await page.keyboard.press('Enter');
  await expect(dialog).toHaveCount(0);
  await expect(columnButton).toBeFocused();
  const card = page.getByRole('button', { name: 'Keyboard task', exact: true });
  await card.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Title', { exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('.inspector')).toHaveCount(0);
  await expect(card).toBeFocused();
  await page.keyboard.press('/');
  await expect(page.getByLabel('Search titles, notes and tags')).toBeFocused();
  await page.keyboard.type('Keyboard task');
  await expect(page.locator('.search-results strong')).toHaveText(
    'Keyboard task',
  );
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('checkbox', { name: 'Include archived work' }),
  ).toBeFocused();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByLabel('Title', { exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('.inspector')).toHaveCount(0);
  // Focus must remain on a connected, usable control after the search unmounts.
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.tagName))
    .not.toBe('BODY');
});

test('mobile details trap focus and nested confirmation restores its trigger', async ({
  page,
}) => {
  await setup(page);
  await task(page, 'Accessible task');
  await page.setViewportSize({ width: 390, height: 844 });
  const card = page.getByRole('button', {
    name: 'Accessible task',
    exact: true,
  });
  await card.focus();
  await page.keyboard.press('Enter');
  const details = page.getByRole('dialog', {
    name: 'Item details',
    exact: true,
  });
  await expect(details).toHaveAttribute('aria-modal', 'true');
  await expect(page.getByLabel('Title', { exact: true })).toBeFocused();
  await page.getByLabel('Description', { exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('button', { name: 'Close details' }),
  ).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByLabel('Description', { exact: true })).toBeFocused();
  await page.getByText('Archive & deletion', { exact: true }).focus();
  await page.keyboard.press('Enter');
  const deletion = page.getByRole('button', { name: 'Delete permanently…' });
  await deletion.focus();
  await page.keyboard.press('Enter');
  const confirmation = page.getByRole('dialog', {
    name: 'Confirm deletion or discard',
    exact: true,
  });
  await expect(confirmation).toBeVisible();
  await expect(confirmation).toHaveAttribute('aria-describedby', /.+/);
  await expect(
    confirmation.getByRole('button', { name: 'Cancel', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(confirmation).toHaveCount(0);
  await expect(deletion).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(details).toHaveCount(0);
  await expect(card).toBeFocused();
});
