import { test, expect, type Page, type Locator } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { setup, task, move } from './helpers';
async function drag(page: Page, handle: Locator, target: Locator) {
  await expect(page.locator('.drag-overlay')).toHaveCount(0);
  await handle.hover();
  const from = await handle.boundingBox(),
    to = await target.boundingBox();
  expect(from).not.toBeNull();
  expect(to).not.toBeNull();
  await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    from!.x + from!.width / 2 + 8,
    from!.y + from!.height / 2,
    { steps: 3 },
  );
  await expect(page.locator('.drag-overlay')).toBeVisible();
  await page.mouse.move(to!.x + to!.width / 2, to!.y + to!.height / 2, {
    steps: 20,
  });
  await page.mouse.up();
  await expect(page.locator('.drag-overlay')).toHaveCount(0);
}
test('pointer and keyboard dragging preserve order and lifecycle', async ({
  page,
}) => {
  await setup(page);
  await page.getByRole('button', { name: 'Toggle utility rail' }).click();
  await task(page, 'One');
  await task(page, 'Two');
  await task(page, 'Three');
  const inbox = page.getByRole('region', { name: 'Inbox column' });
  await drag(
    page,
    page.getByRole('button', { name: 'Drag One', exact: true }),
    page.locator('article').filter({
      has: page.getByRole('button', { name: 'Three', exact: true }),
    }),
  );
  await expect(inbox.locator('.card-title')).toHaveText([
    'Two',
    'Three',
    'One',
  ]);
  await drag(
    page,
    page.getByRole('button', { name: 'Drag One', exact: true }),
    page
      .locator('article')
      .filter({ has: page.getByRole('button', { name: 'Two', exact: true }) }),
  );
  await expect(inbox.locator('.card-title')).toHaveText([
    'One',
    'Two',
    'Three',
  ]);
  await drag(
    page,
    page.getByRole('button', { name: 'Drag One', exact: true }),
    page.getByRole('region', { name: 'Working column' }),
  );
  await expect(
    page.getByRole('region', { name: 'Working column' }).locator('.card-title'),
  ).toHaveText(['One']);
  await page.getByRole('button', { name: 'Drag Two', exact: true }).focus();
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Space');
  await expect(inbox.locator('.card-title')).toHaveText(['Three', 'Two']);
  await drag(
    page,
    page.getByRole('button', { name: 'Drag column Inbox', exact: true }),
    page.getByRole('button', { name: 'Drag column Done', exact: true }),
  );
  await expect(page.locator('.column-header h2')).toHaveText([
    'Working',
    'Done',
    'Inbox',
  ]);
  await page.reload();
  await expect(page.locator('.column-header h2')).toHaveText([
    'Working',
    'Done',
    'Inbox',
  ]);
});
test('two tabs retain conflicting text and allow deliberate resolution', async ({
  page,
  context,
}) => {
  await setup(page);
  await task(page, 'Shared task');
  await page.getByRole('button', { name: 'Shared task', exact: true }).click();
  const other = await context.newPage();
  await other.goto('./');
  await other.getByRole('button', { name: 'Shared task', exact: true }).click();
  // Stop tab A's debounce so both edits are based on the same stored value.
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
    .fill('Draft from first tab');
  await other
    .getByLabel('Description', { exact: true })
    .fill('Saved from second tab');
  await expect(other.locator('.inspector .save-state').last()).toHaveText(
    'Saved',
  );
  await page.getByLabel('Description', { exact: true }).blur();
  await expect(page.locator('.draft-recovery')).toContainText('another tab');
  await expect(page.getByLabel('Description', { exact: true })).toHaveValue(
    'Draft from first tab',
  );
  await expect(page.locator('.draft-recovery pre')).toHaveText(
    'Saved from second tab',
  );
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Keep my text' }).click();
  await expect(page.locator('.inspector .save-state').last()).toHaveText(
    'Saved',
  );
  await expect(other.getByLabel('Description', { exact: true })).toHaveValue(
    'Draft from first tab',
  );
});
test('tags, global search and filters preserve work', async ({ page }) => {
  await setup(page);
  await task(page, 'Tagged task');
  await task(page, 'Other task');
  await page.getByRole('button', { name: 'Tagged task', exact: true }).click();
  await page.getByLabel('Find or create tag').fill('Research');
  await page.getByRole('button', { name: '+ Create tag', exact: true }).click();
  await expect(page.getByLabel('Research', { exact: true })).toBeChecked();
  await page.getByLabel('Priority', { exact: true }).selectOption('high');
  await page
    .getByLabel('Description', { exact: true })
    .fill('Needle in the notes');
  await expect(page.locator('.inspector .save-state').last()).toHaveText(
    'Saved',
  );
  await page.getByRole('button', { name: 'Close details' }).click();
  await page.getByLabel('Filter tag').selectOption({ label: 'Research' });
  await expect(page.locator('.card-title')).toHaveText(['Tagged task']);
  await page.getByLabel('Filter priority').selectOption('low');
  await expect(page.locator('.card-title')).toHaveCount(0);
  await page.getByLabel('Filter priority').selectOption('');
  await page.getByLabel('Filter tag').selectOption('');
  await expect(page.locator('.card-title')).toHaveText([
    'Tagged task',
    'Other task',
  ]);
  await page.getByRole('button', { name: 'Search /' }).click();
  await page.getByLabel('Search titles, notes and tags').fill('Needle');
  await expect(page.locator('.search-results strong')).toHaveText([
    'Tagged task',
  ]);
});
test('archived projects preserve child access and hide from active search', async ({
  page,
}) => {
  await setup(page);
  await page.keyboard.press('Shift+N');
  await page.getByLabel('Title', { exact: true }).fill('Archived project');
  await page
    .getByRole('button', { name: 'Create project', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Archived project', exact: true })
    .click();
  await task(page, 'Child history');
  await move(page, 'Child history', 'Working');
  await page.getByRole('button', { name: 'Edit details' }).click();
  await page.getByText('Archive & deletion').click();
  page.once('dialog', (d) => d.accept());
  await page
    .locator('.inspector')
    .getByRole('button', { name: 'Archive', exact: true })
    .click();
  await page.getByRole('link', { name: 'Archive', exact: true }).click();
  await page.getByText('Archived project', { exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Child history', exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/Archived project · child tasks/)).toBeVisible();
  await page.getByRole('button', { name: 'Search /' }).click();
  await page.getByLabel('Search titles, notes and tags').fill('Child history');
  await expect(page.getByText('No matching work.')).toBeVisible();
  await page.getByLabel('Include archived work').check();
  await expect(page.locator('.search-results strong')).toHaveText([
    'Child history',
  ]);
});
test('WCAG automated checks for board, inspector, dialogs and routes', async ({
  page,
}) => {
  test.setTimeout(60000);
  const audit = async () => {
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(
      results.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => ({
          target: n.target,
          summary: n.failureSummary,
        })),
      })),
    ).toEqual([]);
  };
  await setup(page);
  await task(page, 'Accessible work');
  await page.getByRole('button', { name: 'Column', exact: true }).focus();
  await page.keyboard.press('Shift+N');
  await page.getByLabel('Title', { exact: true }).fill('Accessible project');
  await page
    .getByRole('button', { name: 'Create project', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await audit();
  await page
    .getByRole('button', { name: 'Accessible work', exact: true })
    .click();
  await audit();
  await page.getByRole('button', { name: 'Close details' }).click();
  await page.getByRole('button', { name: 'Column', exact: true }).click();
  await audit();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  for (const route of ['Calendar', 'Archive', 'Settings']) {
    await page.getByRole('link', { name: route, exact: true }).click();
    await expect(page.locator('h1')).toHaveText(route);
    await audit();
  }
  await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole('button', { name: 'Accessible work', exact: true })
    .click();
  await audit();
  await page.screenshot({ path: 'test-results/v1-mobile-inspector.png' });
});
test('confirmed deletion clears a failed draft without blocking future backups', async ({
  page,
}) => {
  await setup(page);
  await task(page, 'Delete with draft');
  await page
    .getByRole('button', { name: 'Delete with draft', exact: true })
    .click();
  await page.getByLabel('Title', { exact: true }).fill('');
  await page.getByLabel('Title', { exact: true }).blur();
  await expect(page.locator('.draft-recovery')).toBeVisible();
  await page.getByText('Archive & deletion').click();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Delete permanently…' }).click();
  await expect(page.locator('.inspector')).toHaveCount(0);
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Recovery drafts' }),
  ).toHaveCount(0);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export JSON', exact: true }).click();
  await download;
});
