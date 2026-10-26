import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run against the real stack (API, worker, MongoDB, Redis) with the Vite dev server.
 * Start the services first (`npm run services:up`, `npm run seed`), then `npm run test:e2e`.
 * When nothing is listening, Playwright starts `npm run dev` itself (with rate limiting off). If you start the stack
 * yourself, run it with RATE_LIMIT_ENABLED=false or repeated sign-ins will hit the auth rate limiter. Set E2E_BASE_URL to test a deployed build.
 */
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:5173';

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Optional: run against a system Chromium when the matching Playwright browser isn't installed.
        launchOptions: process.env.E2E_CHROMIUM_PATH ? { executablePath: process.env.E2E_CHROMIUM_PATH } : {},
      },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'npm run dev',
        url: 'http://localhost:5173',
        reuseExistingServer: true,
        // Repeated sign-ins from one IP would trip the (intentional) auth rate limiter during test runs.
        env: { RATE_LIMIT_ENABLED: 'false' },
        timeout: 120_000,
      },
});
