import { test, expect } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, extname, sep, basename } from 'node:path';
import { setup, task, confirm } from './helpers';

const execute = promisify(execFile);
let directory: string;
let server: Server;
let activeBuild: string;
let address: string;

test.beforeAll(async () => {
  test.setTimeout(120000);
  directory = await mkdtemp(join(tmpdir(), 'kanban-update-'));
  for (const revision of ['first', 'second']) {
    await execute(
      process.execPath,
      [
        'node_modules/vite/bin/vite.js',
        'build',
        '--outDir',
        join(directory, revision),
      ],
      {
        env: {
          ...process.env,
          GITHUB_SHA: '',
          BUILD_REVISION: revision,
          VITE_BASE_PATH: '/update-test/',
        },
      },
    );
  }
  activeBuild = join(directory, 'first');
  server = createServer(async (request, response) => {
    const pathname = new URL(request.url || '/', 'http://localhost').pathname;
    const relative =
      decodeURIComponent(pathname.slice('/update-test/'.length)) ||
      'index.html';
    const file = resolve(activeBuild, relative);
    if (
      !pathname.startsWith('/update-test/') ||
      !file.startsWith(activeBuild + sep)
    ) {
      response.writeHead(404).end();
      return;
    }
    try {
      const content = await readFile(file);
      const mime: Record<string, string> = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.webmanifest': 'application/manifest+json',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
      };
      response.writeHead(200, {
        'Content-Type': mime[extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      response.end(content);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const socket = server.address();
  if (!socket || typeof socket === 'string') throw Error('No test server port');
  address = `http://127.0.0.1:${socket.port}/update-test/`;
});

test.afterAll(async () => {
  if (server)
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  // mkdtemp returns a dedicated test directory; never remove a configured project path.
  if (
    directory &&
    resolve(directory).startsWith(resolve(tmpdir()) + sep) &&
    basename(directory).startsWith('kanban-update-')
  )
    await rm(directory, { recursive: true, force: true });
});

test('production update flushes pending edits, blocks failed drafts and keeps lazy routes offline', async ({
  browser,
}) => {
  test.setTimeout(60000);
  const context = await browser.newContext({ baseURL: address });
  const page = await context.newPage();
  try {
    await setup(page);
    await task(page, 'Before update');
    await page
      .getByRole('button', { name: 'Before update', exact: true })
      .click();
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.reload();
    await page
      .getByRole('button', { name: 'Before update', exact: true })
      .click();
    await expect
      .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
      .toBe(true);
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
      .fill('Saved through the update');
    activeBuild = join(directory, 'second');
    await page.evaluate(async () => {
      await (await navigator.serviceWorker.ready).update();
    });
    await expect(
      page.getByRole('button', { name: 'Update & restart' }),
    ).toBeVisible();
    await page.getByLabel('Title', { exact: true }).fill('');
    await page.getByRole('button', { name: 'Update & restart' }).click();
    await expect(page.locator('.draft-recovery')).toBeVisible();
    await expect(page.locator('meta[name="app-build"]')).toHaveAttribute(
      'content',
      'first',
    );
    await expect(
      page.getByRole('button', { name: 'Update & restart' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Use saved version' }).click();
    await confirm(page);
    await page
      .getByLabel('Description', { exact: true })
      .fill('Saved through the update, including pending text');
    // Activate without blurring the field: restart itself must flush this draft.
    await page
      .getByRole('button', { name: 'Update & restart' })
      .evaluate((button: HTMLButtonElement) => button.click());
    await expect(page.locator('meta[name="app-build"]')).toHaveAttribute(
      'content',
      'second',
    );
    await context.setOffline(true);
    await page.reload();
    await page
      .getByRole('button', { name: 'Before update', exact: true })
      .click();
    await expect(page.getByLabel('Description', { exact: true })).toHaveValue(
      'Saved through the update, including pending text',
    );
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    await expect(page.locator('.inspector')).toContainText(
      'Saved through the update',
    );
    await page.getByRole('button', { name: 'Close details' }).click();
    for (const route of ['Archive', 'Settings']) {
      await page.getByRole('link', { name: route, exact: true }).click();
      await expect(page.locator('h1')).toHaveText(route);
      await expect(
        page.getByRole('heading', {
          name:
            route === 'Archive'
              ? 'Room for what’s next. A record of what’s done.'
              : 'Data & Backups',
        }),
      ).toBeVisible();
    }
  } finally {
    await context.close();
  }
});
