import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { setup, task, confirm } from './helpers';

for (const action of ['replace', 'clear', 'delete'] as const) {
  test(`another tab can ${action} data without losing pending editor text`, async ({
    page,
    context,
  }) => {
    await setup(page);
    await task(page, 'Shared work');
    await page
      .getByRole('button', { name: 'Shared work', exact: true })
      .click();
    const other = await context.newPage();
    await other.goto('./');
    await other.getByRole('link', { name: 'Settings', exact: true }).click();
    const downloading = other.waitForEvent('download');
    await other
      .getByRole('button', { name: 'Export JSON', exact: true })
      .click();
    const backup = await readFile(await (await downloading).path());
    // Hold only autosave's debounce; the user will explicitly blur after the change.
    await page.evaluate(() => {
      const original = window.setTimeout.bind(window);
      window.setTimeout = ((
        handler: TimerHandler,
        delay?: number,
        ...args: unknown[]
      ) =>
        original(
          handler,
          delay === 550 ? 60000 : delay,
          ...args,
        )) as typeof window.setTimeout;
    });
    await page
      .getByLabel('Description', { exact: true })
      .fill('Important unsaved text');
    if (action === 'replace') {
      await other.getByLabel('Backup file').setInputFiles({
        name: 'backup.json',
        mimeType: 'application/json',
        buffer: backup,
      });
      await other
        .getByRole('button', { name: 'Confirm replace all data' })
        .click();
      await expect(other.getByRole('dialog')).toHaveCount(0);
      await page
        .getByLabel('Description', { exact: true })
        .fill('Important continued text');
      await page.getByLabel('Description', { exact: true }).blur();
      await expect(page.locator('.draft-recovery')).toContainText('restore');
      await expect(page.getByLabel('Description', { exact: true })).toHaveValue(
        'Important continued text',
      );
      await page.getByRole('button', { name: 'Keep my text' }).click();
      await confirm(page);
      await expect(page.locator('.inspector .save-state').last()).toHaveText(
        'Saved',
      );
      await page.reload();
      await page
        .getByRole('button', { name: 'Shared work', exact: true })
        .click();
      await expect(page.getByLabel('Description', { exact: true })).toHaveValue(
        'Important continued text',
      );
    } else {
      if (action === 'clear') {
        await other
          .getByRole('button', { name: 'Clear all live data…' })
          .click();
        await other.getByLabel('Type CLEAR to confirm').fill('CLEAR');
        await confirm(other);
      } else {
        await other
          .getByRole('link', { name: 'Dashboard', exact: true })
          .click();
        await other
          .getByRole('button', { name: 'Delete task Shared work', exact: true })
          .click();
        await confirm(other);
      }
      await expect(
        page.getByRole('heading', { name: 'Item unavailable' }),
      ).toBeVisible();
      await page
        .getByRole('link', { name: 'Recovery drafts in Settings' })
        .click();
      await expect(page.getByLabel('Unsaved Description')).toHaveValue(
        'Important unsaved text',
      );
      const recovery = page.waitForEvent('download');
      await page
        .getByRole('button', { name: 'Download text', exact: true })
        .click();
      expect(await readFile(await (await recovery).path(), 'utf8')).toBe(
        'Important unsaved text',
      );
    }
  });
}
