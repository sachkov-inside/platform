import { defineConfig } from "@playwright/test";

/** Owned isolated editor runtime; never starts or resets the shared Compose stand. */
export default defineConfig({
  testDir: "./test/local",
  testMatch: ["material-quiz.spec.ts", "storybook-quiz.spec.ts"],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 60_000,
  use: {
    baseURL: "http://127.0.0.1:4396",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop-chromium",
      use: { browserName: "chromium", viewport: { width: 1440, height: 1024 } },
    },
    {
      name: "mobile-chromium",
      use: {
        browserName: "chromium",
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
});
