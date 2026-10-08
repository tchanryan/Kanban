import { expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, win32 } from 'node:path';
import process from 'node:process';
import { connectPreview, invoke } from './Native-Preview.mjs';

const [endpoint, fixturePath, ownedRoot, destination] = process.argv.slice(2);
if (
  ![fixturePath, ownedRoot, destination].every((value) =>
    isAbsolute(value ?? ''),
  )
)
  throw new Error(
    'Provide absolute fixture, owned data root and evidence paths.',
  );
const { browser, page } = await connectPreview(endpoint);
let safety;
try {
  const status = await invoke(page, 'recovery_status');
  if (
    !win32
      .resolve(status.storagePath)
      .toLowerCase()
      .startsWith(win32.resolve(ownedRoot).toLowerCase() + '\\')
  )
    throw new Error('Preview is outside its marked synthetic profile.');
  if ((await invoke(page, 'draft_list')).length)
    throw new Error('Resolve synthetic drafts before interaction acceptance.');
  const canonical = async () => {
    const backup = await invoke(page, 'portable_export');
    delete backup.exportedAt;
    return JSON.stringify(backup);
  };
  const original = await canonical();
  safety = await invoke(page, 'backup_now');
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
  const preview = await invoke(page, 'portable_preview', { backup: fixture });
  await invoke(page, 'portable_import', {
    ticket: preview.ticket,
    confirmed: true,
  });
  await page.reload();
  await expect(page.getByLabel('New task in Inbox')).toBeVisible();
  for (const title of ['Native One', 'Native Two', 'Native Three']) {
    await page.getByLabel('New task in Inbox').fill(title);
    await page.getByLabel('New task in Inbox').press('Enter');
    await expect(
      page.getByRole('button', { name: title, exact: true }),
    ).toBeVisible();
  }
  const inbox = page.getByRole('region', { name: 'Inbox column' });
  const titles = async () =>
    (await inbox.locator('.card-title').allTextContents()).filter((title) =>
      title.startsWith('Native '),
    );
  const handle = page.getByRole('button', {
    name: 'Drag Native One',
    exact: true,
  });
  const target = page.locator('article').filter({
    has: page.getByRole('button', { name: 'Native Three', exact: true }),
  });
  await handle.hover();
  const from = await handle.boundingBox(),
    to = await target.boundingBox();
  if (!from || !to) throw new Error('Native drag targets were not laid out.');
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 8, from.y + from.height / 2, {
    steps: 3,
  });
  await expect(page.locator('.drag-overlay')).toBeVisible();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
    steps: 20,
  });
  await page.mouse.up();
  await expect(page.locator('.drag-overlay')).toHaveCount(0);
  await expect
    .poll(titles)
    .toEqual(['Native Two', 'Native Three', 'Native One']);
  await page
    .getByRole('button', { name: 'Drag Native Two', exact: true })
    .focus();
  await page.keyboard.press('Space');
  const overlay = page.locator('.drag-overlay');
  await expect(overlay).toBeVisible();
  const lifted = await overlay.boundingBox();
  if (!lifted) throw new Error('Keyboard drag overlay was not laid out.');
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        globalThis.requestAnimationFrame(() =>
          globalThis.requestAnimationFrame(resolve),
        ),
      ),
  );
  await page.keyboard.press('ArrowDown');
  await expect
    .poll(async () => ((await overlay.boundingBox())?.y ?? lifted.y) - lifted.y)
    .toBeGreaterThan(0);
  await page.keyboard.press('Space');
  await expect
    .poll(titles)
    .toEqual(['Native Three', 'Native Two', 'Native One']);
  await page.getByRole('button', { name: 'Column', exact: true }).click();
  await page.getByLabel('Column name').fill('Native Working');
  await page.getByLabel('Start work on first entry').check();
  await page
    .getByRole('button', { name: 'Create column', exact: true })
    .click();
  await page.getByRole('button', { name: 'Native One', exact: true }).click();
  await page
    .locator('.inspector')
    .getByLabel('Move to…')
    .selectOption({ label: 'Native Working' });
  await page.getByRole('button', { name: 'Close details' }).click();
  await expect(
    page
      .getByRole('region', { name: 'Native Working column' })
      .getByRole('button', { name: 'Native One', exact: true }),
  ).toBeVisible();
  const exported = await invoke(page, 'portable_export');
  if (
    !exported.items.find((item) => item.title === 'Native One')?.firstStartedAt
  )
    throw new Error('Native column movement did not record lifecycle start.');
  await page.reload();
  await expect.poll(titles).toEqual(['Native Three', 'Native Two']);
  await expect(
    page
      .getByRole('region', { name: 'Native Working column' })
      .getByRole('button', { name: 'Native One', exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: win32.join(win32.dirname(destination), 'session9-interactions.png'),
  });
  await invoke(page, 'restore_backup', { id: safety.id, confirmed: true });
  safety = undefined;
  if ((await canonical()) !== original)
    throw new Error(
      'Interaction acceptance did not restore the original workspace.',
    );
  await writeFile(
    destination,
    JSON.stringify(
      {
        keyboardCapture: true,
        pointerReorder: true,
        keyboardReorder: true,
        columnLifecycle: true,
        reloadPersistence: true,
        originalRestored: true,
        applicationVersion: status.appVersion,
        completedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
} catch (error) {
  if (safety) {
    await page.screenshot({
      path: win32.join(
        win32.dirname(destination),
        'session9-interactions-failure.png',
      ),
    });
    const diagnostics = await page.evaluate(() => ({
      focusedControl:
        globalThis.document.activeElement?.getAttribute('aria-label'),
      viewport: {
        width: globalThis.innerWidth,
        height: globalThis.innerHeight,
      },
      cards: Array.from(
        globalThis.document.querySelectorAll('.card-title'),
      ).map((element) => ({
        title: element.textContent,
        rect: element.getBoundingClientRect().toJSON(),
      })),
      overlays: Array.from(
        globalThis.document.querySelectorAll('.drag-overlay'),
      ).map((element) => ({ rect: element.getBoundingClientRect().toJSON() })),
    }));
    await writeFile(
      win32.join(
        win32.dirname(destination),
        'session9-interactions-failure.json',
      ),
      JSON.stringify(diagnostics, null, 2),
    );
  }
  throw error;
} finally {
  try {
    if (safety)
      await invoke(page, 'restore_backup', { id: safety.id, confirmed: true });
  } finally {
    await browser.close();
  }
}
