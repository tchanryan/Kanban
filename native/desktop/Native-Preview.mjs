import { chromium } from '@playwright/test';
import { setTimeout } from 'node:timers';

export async function connectPreview(endpoint) {
  if (!/^http:\/\/127\.0\.0\.1:\d+$/u.test(endpoint ?? ''))
    throw new Error('Only a loopback native preview endpoint is allowed.');
  const deadline = Date.now() + 25000;
  let browser;
  while (!browser && Date.now() < deadline) {
    try {
      browser = await chromium.connectOverCDP(endpoint);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  if (!browser) throw new Error('Owned native preview endpoint did not start.');
  try {
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
    await page.waitForFunction(() => !!globalThis.__TAURI__?.core);
    return { browser, page };
  } catch (error) {
    await browser.close();
    throw error;
  }
}

export async function invoke(page, command, args = {}) {
  return page.evaluate(
    ({ command, args }) => globalThis.__TAURI__.core.invoke(command, args),
    { command, args },
  );
}
