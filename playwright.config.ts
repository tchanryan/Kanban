import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  use: {
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    baseURL: `http://127.0.0.1:4173${process.env.PLAYWRIGHT_BASE_PATH || '/'}`,
    headless: true,
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `npm run preview -- --port 4173 --base ${process.env.PLAYWRIGHT_BASE_PATH || '/'}`,
    url: `http://127.0.0.1:4173${process.env.PLAYWRIGHT_BASE_PATH || '/'}`,
    reuseExistingServer: !process.env.CI,
  },
  reporter: [['list'], ['html', { open: 'never' }]],
});
