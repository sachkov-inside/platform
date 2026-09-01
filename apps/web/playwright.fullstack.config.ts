import { defineConfig } from "@playwright/test";

const baseURL = process.env.FULLSTACK_WEB_BASE_URL ?? "http://127.0.0.1:3000";

export default defineConfig({
  testDir: "./test/fullstack",
  fullyParallel: false,
  forbidOnly: true,
  reporter: "list",
  timeout: 60_000,
  workers: 1,
  use: {
    baseURL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop-chromium",
      use: { browserName: "chromium", viewport: { width: 1_440, height: 1_024 } },
    },
    {
      name: "mobile-chromium",
      use: {
        browserName: "chromium",
        hasTouch: true,
        isMobile: true,
        viewport: { width: 390, height: 844 },
      },
    },
  ],
});
