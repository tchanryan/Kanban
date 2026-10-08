import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

function canonical(input: Record<string, unknown>): unknown {
  const { exportedAt: _, ...data } = input;
  void _;
  const identity = (record: {
    id?: string;
    itemId?: string;
    tagId?: string;
  }): string => record.id ?? `${record.itemId}/${record.tagId}`;
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [
      key,
      Array.isArray(value)
        ? [...value].sort((a, b) => identity(a).localeCompare(identity(b)))
        : value,
    ]),
  );
}
test('native portable export returns to a browser through reviewed replacement and re-export', async ({
  page,
}) => {
  const path =
    process.env.NATIVE_PORTABLE_EXPORT ||
    'native/workspace/tests/fixtures/portable-native.json';
  const expected = JSON.parse(
    await readFile('native/workspace/tests/fixtures/portable-v1.json', 'utf8'),
  ) as Record<string, unknown>;
  await page.goto('./#/settings');
  await page.getByLabel('Backup file').setInputFiles(path);
  await expect(
    page.getByRole('dialog', { name: 'Review replacement backup' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Confirm replace all data' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.reload();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export JSON', exact: true }).click();
  const download = await downloadPromise;
  const actual = JSON.parse(
    await readFile((await download.path())!, 'utf8'),
  ) as Record<string, unknown>;
  expect(canonical(actual)).toEqual(canonical(expected));
  await page.goto('./');
  await expect(
    page.getByRole('button', { name: 'Migration project', exact: true }),
  ).toBeVisible();
  await expect(page.locator('#scratchpad-global')).toHaveValue(
    'Browser original notes\nDo not modify source',
  );
});
