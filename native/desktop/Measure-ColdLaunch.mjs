import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import process from 'node:process';
import { setTimeout } from 'node:timers';

const [endpoint, destination] = process.argv.slice(2);
if (
  !/^http:\/\/127\.0\.0\.1:\d+$/u.test(endpoint ?? '') ||
  !isAbsolute(destination ?? '')
)
  throw new Error(
    'Provide a loopback CDP endpoint and absolute evidence path.',
  );
let browser;
try {
  const deadline = Date.now() + 25000;
  while (!browser && Date.now() < deadline) {
    try {
      browser = await chromium.connectOverCDP(endpoint);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  if (!browser)
    throw new Error('Owned native preview debugging endpoint did not start.');
  let page;
  while (!page && Date.now() < deadline) {
    page = browser
      .contexts()
      .flatMap((context) => context.pages())
      .find((candidate) =>
        candidate.url().startsWith('http://tauri.localhost/'),
      );
    if (!page) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!page) throw new Error('Bundled native window did not appear.');
  const session = await page.context().newCDPSession(page);
  await session.send('Network.enable');
  await session.send('Network.emulateNetworkConditions', {
    offline: true,
    latency: 0,
    downloadThroughput: 0,
    uploadThroughput: 0,
  });
  await page.waitForFunction(
    () =>
      globalThis.performance
        .getEntriesByName('kanban:board-ready')
        .some((entry) => entry.detail?.itemCount === 703),
    undefined,
    { timeout: 25000 },
  );
  const result = await page.evaluate(() => ({
    boardMilliseconds: globalThis.performance
      .getEntriesByName('kanban:board-ready')
      .find((entry) => entry.detail?.itemCount === 703).startTime,
    navigation: globalThis.performance
      .getEntriesByType('navigation')
      .map((entry) => entry.toJSON()),
    resources: globalThis.performance
      .getEntriesByType('resource')
      .map((entry) => ({
        name: entry.name,
        start: entry.startTime,
        responseEnd: entry.responseEnd,
      })),
    cardCount: globalThis.document.querySelectorAll('.card-title').length,
  }));
  await writeFile(
    destination,
    JSON.stringify(
      {
        ...result,
        method:
          'Normal owned process launch with loopback CDP observation; no WebDriver',
        completedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
} finally {
  // Closing a CDP connection disconnects Playwright; the owning PowerShell harness closes the app normally.
  await browser?.close();
}
