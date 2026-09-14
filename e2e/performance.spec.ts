import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { scaleFixture } from './scale-fixture';
test('large workspace renders only its active board and paginates archive', async ({
  page,
}, testInfo) => {
  test.setTimeout(120000);
  await page.goto('./');
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Backup file').setInputFiles({
    name: 'synthetic-scale.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(scaleFixture())),
  });
  await page.getByRole('button', { name: 'Confirm replace all data' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const started = Date.now();
  await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
  await expect(page.locator('.card-title')).toHaveCount(703, {
    timeout: 30000,
  });
  const dashboardMs = Date.now() - started;
  const filterStart = Date.now();
  await page.getByLabel('Filter type').selectOption('project');
  await expect(page.locator('.card-title')).toHaveCount(3);
  const filterMs = Date.now() - filterStart;
  const archiveStart = Date.now();
  await page.getByRole('link', { name: 'Archive', exact: true }).click();
  await expect(page.locator('.archive-row')).toHaveCount(50);
  const archiveMs = Date.now() - archiveStart;
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.getByText('Page 2 · 50 items')).toBeVisible();
  await testInfo.attach('scale-timings.json', {
    body: JSON.stringify(
      {
        activeTasks: 1000,
        projects: 3,
        archivedTasks: 10000,
        events: 25000,
        columns: 20,
        dashboardMs,
        filterMs,
        archiveMs,
      },
      null,
      2,
    ),
    contentType: 'application/json',
  });
  await writeFile(
    testInfo.outputPath('scale-timings.json'),
    JSON.stringify({ dashboardMs, filterMs, archiveMs }, null, 2),
  );
  expect(dashboardMs).toBeLessThan(15000);
  expect(filterMs).toBeLessThan(5000);
  expect(archiveMs).toBeLessThan(5000);
});
