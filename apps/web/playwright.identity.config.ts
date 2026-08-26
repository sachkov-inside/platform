import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test/identity",
  fullyParallel: false,
  forbidOnly: true,
  reporter: "list",
  retries: 0,
  timeout: 180_000,
  workers: 1,
  use: {
    baseURL: process.env.WEB_BASE_URL ?? "http://127.0.0.1:3500",
    ignoreHTTPSErrors: true,
    screenshot: "off",
    trace: "off",
  },
  projects: [
    {
      name: "pinned-logto-chromium",
      use: { browserName: "chromium", viewport: { width: 1_440, height: 1_024 } },
    },
  ],
});
