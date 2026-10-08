import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { writeFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import process from 'node:process';

const destination = process.argv[2];
if (!destination || !isAbsolute(destination)) {
  throw new Error('Provide an absolute evidence filename.');
}
const server = createServer((_request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html' });
  response.end(
    '<!doctype html><title>Disposable browser storage fixture</title>',
  );
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ channel: 'chrome' });
  const context = await browser.newContext();
  const page = await context.newPage();
  const origin = `http://127.0.0.1:${server.address().port}`;
  await page.goto(origin);
  await page.evaluate(async () => {
    globalThis.localStorage.setItem('fixture', 'Synthetic browser work');
    globalThis.document.cookie = 'fixture=synthetic; SameSite=Lax';
    const cache = await globalThis.caches.open('synthetic-fixture');
    await cache.put(
      '/cached-fixture',
      new globalThis.Response('Synthetic cached work'),
    );
    await new Promise((resolve, reject) => {
      const request = globalThis.indexedDB.open('synthetic-browser-work', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('work');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction('work', 'readwrite');
        transaction
          .objectStore('work')
          .put('Synthetic browser work', 'fixture');
        transaction.oncomplete = () => {
          database.close();
          resolve();
        };
        transaction.onerror = () => reject(transaction.error);
      };
    });
  });
  const session = await context.newCDPSession(page);
  await session.send('Storage.clearDataForOrigin', {
    origin,
    storageTypes: 'all',
  });
  await session.send('Network.clearBrowserCache');
  const cleared = await page.evaluate(
    async () =>
      globalThis.localStorage.length === 0 &&
      globalThis.document.cookie === '' &&
      (await globalThis.indexedDB.databases()).length === 0 &&
      (await globalThis.caches.keys()).length === 0,
  );
  if (!cleared) throw new Error('Disposable browser storage did not clear.');
  await writeFile(
    destination,
    JSON.stringify(
      {
        browser: await browser.version(),
        cookiesCleared: true,
        localStorageCleared: true,
        indexedDbCleared: true,
        cacheStorageCleared: true,
        profile: 'Playwright-created isolated Chrome profile',
        completedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
