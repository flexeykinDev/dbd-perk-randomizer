import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    // The site auto-detects RU vs EN from the browser's own locale (see
    // lib/i18n.tsx) when there's no saved preference — Playwright's default
    // Chromium locale is en-US, which flips every page to English on first
    // load and breaks every RU-text assertion below. Pin it to match what
    // the tests actually assert against.
    locale: "ru-RU",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
