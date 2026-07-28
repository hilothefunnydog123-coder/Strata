import { defineConfig, devices } from '@playwright/test';

/**
 * End to end tests run against a real build, a real PostgreSQL database, and a
 * real HTTP server. Nothing is stubbed: the point of these is to catch the
 * things unit tests structurally cannot, like a server action that authorises
 * correctly in isolation but is reachable by a route that never calls it.
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: {
    command: `pnpm build && PORT=${PORT} pnpm start`,
    url: baseURL,
    // Never reuse. A server left running from an earlier run serves the
    // previous build, so a fix appears not to work and the wrong thing gets
    // debugged. The extra minute per run is worth not chasing that ghost.
    reuseExistingServer: false,
    timeout: 300_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
