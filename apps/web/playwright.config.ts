import { defineConfig } from "@playwright/test";

const port = process.env.PLAYWRIGHT_PORT ?? "3100";
const baseURL = `http://127.0.0.1:${port}`;
const captureEvidence = process.env.CAPTURE_EVIDENCE === "1";

export default defineConfig({
  testDir: "./test/e2e",
  testMatch: captureEvidence ? "evidence.spec.ts" : "routes.spec.ts",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop-chromium",
      use: {
        browserName: "chromium",
        viewport: { width: 1_440, height: 1_024 },
      },
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
  webServer: {
    command: captureEvidence
      ? `pnpm build && pnpm start --hostname 127.0.0.1 --port ${port}`
      : `pnpm dev --hostname 127.0.0.1 --port ${port}`,
    env: {
      BACKEND_BASE_URL:
        process.env.PLAYWRIGHT_BACKEND_BASE_URL ?? "http://127.0.0.1:1",
    },
    url: baseURL,
    reuseExistingServer: false,
    stdout: "ignore",
    stderr: "pipe",
    timeout: 120_000,
  },
});
