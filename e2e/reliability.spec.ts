import { test, expect, type Page, type Locator } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { setup, task, move, confirm } from './helpers';
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
  const overlay = page.locator('.drag-overlay');
  await expect(overlay).toBeVisible();
  const lifted = await overlay.boundingBox();
  expect(lifted).not.toBeNull();
  await page.keyboard.press('ArrowDown');
  // Keyboard activation and collision updates are asynchronous. Drop only
  // after the requested movement has rendered, rather than racing the sensor.
  await expect
    .poll(async () => (await overlay.boundingBox())?.y ?? lifted!.y)
    .toBeGreaterThan(lifted!.y);
  await page.keyboard.press('Space');
  await expect(overlay).toHaveCount(0);
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
  await page.getByRole('button', { name: 'Keep my text' }).click();
  await confirm(page, true);
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
  await page
    .getByRole('button', { name: '+ Create tag “Research”', exact: true })
    .click();
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
  await task(page, 'Child history', 'todo');
  await move(page, 'Child history', 'in-progress');
  await page.getByRole('button', { name: 'Edit details' }).click();
  await page.getByText('Archive & deletion').click();
  await page
    .locator('.inspector')
    .getByRole('button', { name: 'Archive', exact: true })
    .click();
  await confirm(page, true);
  await page.getByRole('link', { name: 'Archive', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Archive', exact: true }),
  ).toBeVisible();
  // The previous project heading can remain during the lazy route transition.
  // Only the archive row's button can reopen the project.
  await page
    .locator('.archive-row')
    .getByRole('button', {
      name: /^project Archived project Completed:/,
    })
    .click();
  await expect(page).toHaveURL(/#\/projects\//);
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
  await page.getByRole('button', { name: 'Delete permanently…' }).click();
  await confirm(page, true);
  await expect(page.locator('.inspector')).toHaveCount(0);
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Recovery drafts' }),
  ).toHaveCount(0);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export JSON', exact: true }).click();
  await download;
});

test('New menu stays above task details and history is inline for tasks and projects', async ({
  page,
}) => {
  await setup(page);
  await task(page, 'History task');
  await page.getByRole('button', { name: 'History task', exact: true }).click();
  const checkHistory = async () => {
    await page
      .locator('.inspector summary')
      .filter({ hasText: 'History' })
      .click();
    const entry = page.locator('.history li').first();
    await expect(entry).toHaveText(
      /created - \d{1,2}\/\d{1,2}\/\d{4} \d{1,2}:\d{2}:\d{2} [AP]M/,
    );
    const event = await entry.locator('strong').boundingBox();
    const time = await entry.locator('time').boundingBox();
    expect(Math.abs(event!.y - time!.y)).toBeLessThan(3);
  };
  await checkHistory();
  await page.locator('.new-menu > summary').click();
  // A real click verifies the inspector does not intercept the menu option.
  await page.getByRole('button', { name: 'New Project' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page
    .getByRole('dialog')
    .getByLabel('Title', { exact: true })
    .fill('History project');
  await page
    .getByRole('button', { name: 'Create project', exact: true })
    .click();
  await page.getByRole('button', { name: 'Close details' }).click();
  await page
    .getByRole('button', { name: 'History project', exact: true })
    .click();
  await page.getByRole('button', { name: 'Edit details' }).click();
  await checkHistory();
});

test('board fits three columns and extends horizontally with full-height columns', async ({
  page,
}) => {
  await setup(page);
  const measure = () =>
    page.locator('.board').evaluate((board) => {
      const columns = [...board.querySelectorAll('.column')].map((el) =>
        el.getBoundingClientRect(),
      );
      const style = getComputedStyle(board);
      const rect = board.getBoundingClientRect();
      return {
        widths: columns.map((c) => c.width),
        bottoms: columns.map((c) => c.bottom),
        available:
          board.clientWidth -
          parseFloat(style.paddingLeft) -
          parseFloat(style.paddingRight),
        gap: parseFloat(style.columnGap),
        bottom: rect.bottom - parseFloat(style.paddingBottom),
        clientWidth: board.clientWidth,
        scrollWidth: board.scrollWidth,
      };
    });
  const initial = await measure();
  expect(
    Math.abs(
      initial.widths.reduce((a, b) => a + b, 0) +
        initial.gap * 2 -
        initial.available,
    ),
  ).toBeLessThan(2);
  for (const bottom of initial.bottoms)
    expect(Math.abs(bottom - initial.bottom)).toBeLessThan(2);
  await page.getByRole('button', { name: 'Column', exact: true }).click();
  await page.getByLabel('Column name').fill('Later');
  await page
    .getByRole('button', { name: 'Create column', exact: true })
    .click();
  await expect(page.locator('.column')).toHaveCount(4);
  const expanded = await measure();
  expect(expanded.scrollWidth).toBeGreaterThan(expanded.clientWidth);
  for (const width of expanded.widths)
    expect(Math.abs(width - initial.widths[0])).toBeLessThan(2);
  await page.screenshot({ path: 'test-results/full-height-board.png' });
});

test('long columns keep capture controls visible and mobile boards use remaining viewport height', async ({
  page,
}) => {
  await setup(page);
  for (let n = 1; n <= 16; n++) await task(page, `Long list ${n}`);
  const inbox = page.getByRole('region', { name: 'Inbox column' });
  const list = inbox.locator('.card-list');
  expect(await list.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(
    true,
  );
  await expect(inbox.getByLabel('New task in Inbox')).toBeInViewport();
  await list.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect(
    inbox.getByRole('heading', { name: 'Inbox', exact: true }),
  ).toBeInViewport();
  await expect(inbox.getByLabel('New task in Inbox')).toBeInViewport();
  await page.setViewportSize({ width: 390, height: 844 });
  const board = await page.locator('.board').boundingBox();
  expect(Math.abs(board!.y + board!.height - 844)).toBeLessThan(2);
  await expect(inbox.getByLabel('New task in Inbox')).toBeInViewport();
  await page.screenshot({ path: 'test-results/mobile-long-board.png' });
});

test('board zoom fits more columns, preserves height and resets', async ({
  page,
}) => {
  await setup(page);
  await task(page, 'Zoom task');
  await page.getByRole('button', { name: 'Column', exact: true }).click();
  await page.getByLabel('Column name').fill('Later');
  await page
    .getByRole('button', { name: 'Create column', exact: true })
    .click();
  await expect(page.locator('.column')).toHaveCount(4);
  const before = await page.locator('.column').first().boundingBox();
  for (let i = 0; i < 3; i++)
    await page
      .getByRole('button', { name: 'Zoom out board', exact: true })
      .click();
  await expect(
    page.getByRole('button', { name: 'Reset board zoom (70%)', exact: true }),
  ).toBeVisible();
  const after = await page.locator('.column').first().boundingBox();
  expect(after!.width).toBeLessThan(before!.width * 0.75);
  expect(Math.abs(after!.height - before!.height)).toBeLessThan(2);
  expect(
    await page
      .locator('.board')
      .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  ).toBe(true);
  await move(page, 'Zoom task', 'Working');
  await expect(
    page
      .getByRole('region', { name: 'Working column' })
      .getByRole('button', { name: 'Zoom task', exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: 'test-results/board-zoom.png' });
  await page
    .getByRole('button', { name: 'Reset board zoom (70%)', exact: true })
    .click();
  const reset = await page.locator('.column').first().boundingBox();
  expect(Math.abs(reset!.width - before!.width)).toBeLessThan(2);
  await page
    .getByRole('button', { name: 'Zoom in board', exact: true })
    .click();
  expect(
    (await page.locator('.column').first().boundingBox())!.width,
  ).toBeGreaterThan(before!.width);
});

test('themed tile confirmations preserve cancellation and require two approvals for projects with tasks', async ({
  page,
}) => {
  await setup(page);
  await task(page, 'Delete tile task');
  const taskDelete = page.getByRole('button', {
    name: 'Delete task Delete tile task',
    exact: true,
  });
  await taskDelete.click();
  await expect(
    page
      .locator('.confirmation-dialog')
      .getByRole('button', { name: 'Cancel' }),
  ).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(taskDelete).toBeFocused();
  await taskDelete.click();
  await confirm(page);
  await expect(taskDelete).toHaveCount(0);
  await expect(page.locator('.confirmation-dialog')).toHaveCount(0);
  const project = async (title: string) => {
    await page.getByRole('button', { name: 'Column', exact: true }).focus();
    await page.keyboard.press('Shift+N');
    await page.getByLabel('Title', { exact: true }).fill(title);
    await page
      .getByRole('button', { name: 'Create project', exact: true })
      .click();
  };
  await project('Empty project');
  const emptyDelete = page.getByRole('button', {
    name: 'Delete project Empty project',
    exact: true,
  });
  await emptyDelete.click();
  await confirm(page);
  await expect(emptyDelete).toHaveCount(0);
  await expect(page.locator('.confirmation-dialog')).toHaveCount(0);
  await project('Populated project');
  await page
    .getByRole('button', { name: 'Populated project', exact: true })
    .click();
  await task(page, 'Completed child', 'todo');
  await move(page, 'Completed child', 'completed');
  await page
    .getByRole('link', { name: 'Dashboard', exact: true })
    .first()
    .click();
  const populatedDelete = page.getByRole('button', {
    name: 'Delete project Populated project',
    exact: true,
  });
  await populatedDelete.click();
  await confirm(page);
  await expect(page.locator('.confirmation-dialog')).toContainText('1 task');
  await page.screenshot({ path: 'test-results/themed-confirmation.png' });
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze()
    ).violations,
  ).toEqual([]);
  await confirm(page, false);
  await expect(populatedDelete).toBeVisible();
  await page
    .getByRole('button', { name: 'Populated project', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Completed child', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('link', { name: 'Dashboard', exact: true })
    .first()
    .click();
  await populatedDelete.click();
  await confirm(page);
  await expect(page.locator('.confirmation-dialog')).toContainText('1 task');
  await confirm(page);
  await expect(populatedDelete).toHaveCount(0);
  await page.reload();
  await expect(populatedDelete).toHaveCount(0);
});

test('shared tag suggestions apply across tasks and projects and cards size to their tags', async ({
  page,
}) => {
  await setup(page);
  await task(page, 'Tagged source');
  await task(page, 'Tag recipient');
  const source = page.locator('article').filter({
    has: page.getByRole('button', { name: 'Tagged source', exact: true }),
  });
  const emptyHeight = (await source.boundingBox())!.height;
  await expect(source.locator('.card-tags')).toHaveCount(0);
  await expect(source.locator('summary')).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Tagged source', exact: true })
    .click();
  await page.getByLabel('Find or create tag').fill('Shared label');
  await page
    .getByRole('group', { name: 'Tag colour', exact: true })
    .getByRole('button', { name: 'teal', exact: true })
    .click();
  await page
    .getByRole('button', { name: '+ Create tag “Shared label”', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Remove tag Shared label', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Close details' }).click();
  await expect(source.locator('.card-tags')).toHaveText('Shared label');
  expect((await source.boundingBox())!.height).toBeGreaterThan(emptyHeight);
  await page
    .getByRole('button', { name: 'Tag recipient', exact: true })
    .click();
  await page.getByLabel('Find or create tag').fill('shared');
  await page
    .getByRole('checkbox', { name: 'Shared label', exact: true })
    .check();
  await expect(
    page.getByRole('button', { name: 'Remove tag Shared label', exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: 'test-results/tag-suggestions.png' });
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.getByRole('button', { name: 'Close details' }).click();
  await page.getByRole('button', { name: 'Column', exact: true }).focus();
  await page.keyboard.press('Shift+N');
  await page.getByLabel('Title', { exact: true }).fill('Tagged project');
  await page
    .getByRole('button', { name: 'Create project', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Tagged project', exact: true })
    .click();
  await page.getByRole('button', { name: 'Edit details' }).click();
  await page.getByLabel('Find or create tag').fill('Shared label');
  await expect(page.getByRole('button', { name: /Create tag/ })).toHaveCount(0);
  await page
    .getByRole('checkbox', { name: 'Shared label', exact: true })
    .check();
  await page.getByRole('button', { name: 'Close details' }).click();
  await page
    .getByRole('link', { name: 'Dashboard', exact: true })
    .first()
    .click();
  await expect(page.locator('.card-tags')).toHaveCount(3);
  await page
    .getByRole('button', { name: 'Tagged source', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Remove tag Shared label', exact: true })
    .click();
  await page.getByRole('button', { name: 'Close details' }).click();
  await expect(source.locator('.card-tags')).toHaveCount(0);
  expect(
    Math.abs((await source.boundingBox())!.height - emptyHeight),
  ).toBeLessThan(2);
  await page.reload();
  await expect(page.locator('.card-tags')).toHaveCount(2);
});

test('themed confirmations work over mobile details and require CLEAR before clearing', async ({
  page,
}) => {
  await setup(page);
  await task(page, 'Keep mobile work');
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole('button', { name: 'Keep mobile work', exact: true })
    .click();
  await page.getByText('Archive & deletion').click();
  await page.getByRole('button', { name: 'Delete permanently…' }).click();
  await expect(page.locator('.confirmation-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.inspector')).toBeVisible();
  await page.getByRole('button', { name: 'Close details' }).click();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page
    .getByRole('button', { name: 'Clear all live data…', exact: true })
    .click();
  const dialog = page.locator('.confirmation-dialog');
  await expect(
    dialog.getByRole('button', { name: 'Confirm', exact: true }),
  ).toBeDisabled();
  await dialog.getByLabel('Type CLEAR to confirm').fill('clear');
  await expect(
    dialog.getByRole('button', { name: 'Confirm', exact: true }),
  ).toBeDisabled();
  await dialog.getByLabel('Type CLEAR to confirm').fill('CLEAR');
  await expect(
    dialog.getByRole('button', { name: 'Confirm', exact: true }),
  ).toBeEnabled();
  await confirm(page, false);
  await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Keep mobile work', exact: true }),
  ).toBeVisible();
});

test('active tag filters update when assignments change and reset without losing cards', async ({
  page,
}) => {
  await setup(page);
  await task(page, 'Filtered task');
  await task(page, 'Untagged task');
  await page
    .getByRole('button', { name: 'Filtered task', exact: true })
    .click();
  await page.getByLabel('Find or create tag').fill('Filter label');
  await page
    .getByRole('button', { name: '+ Create tag “Filter label”', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Remove tag Filter label', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Close details' }).click();
  await page
    .getByLabel('Filter tag', { exact: true })
    .selectOption({ label: 'Filter label' });
  await expect(page.locator('article.card')).toHaveCount(1);
  await page
    .getByRole('button', { name: 'Filtered task', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Remove tag Filter label', exact: true })
    .click();
  await expect(page.locator('article.card')).toHaveCount(0);
  await page.getByLabel('Find or create tag').fill('Filter label');
  await page
    .getByRole('checkbox', { name: 'Filter label', exact: true })
    .check();
  await expect(page.locator('article.card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Close details' }).click();
  await page.getByLabel('Filter tag', { exact: true }).selectOption('');
  await expect(page.locator('article.card')).toHaveCount(2);
  await page.reload();
  await expect(page.locator('article.card')).toHaveCount(2);
  await expect(page.locator('.card-tags')).toHaveCount(1);
});
