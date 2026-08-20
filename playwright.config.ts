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
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: /mobile\.spec\.ts/,
    },
    // Every test had only ever run at desktop width, despite the site
    // having had a responsive pass. Pixel 7 rather than a bare 375px
    // viewport because it also brings the touch flags and the mobile user
    // agent, so anything gated on hover or pointer type behaves the way it
    // would on a phone rather than on a narrow desktop window.
    //
    // The mobile-only checks live in e2e/mobile.spec.ts; the main suite
    // stays desktop-only via testIgnore, because running all 63 twice
    // doubles CI for very little — what differs on a phone is layout and
    // reach, not whether a perk rolls.
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /mobile\.spec\.ts/ },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
