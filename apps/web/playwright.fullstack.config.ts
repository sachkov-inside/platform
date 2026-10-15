import { defineConfig } from "@playwright/test";
import { fullStackProjects } from "../../scripts/full-stack-options.mjs";

const baseURL =
  process.env["FULLSTACK_WEB_BASE_URL"] ?? "http://127.0.0.1:3000";

export default defineConfig({
  testDir: "./test/fullstack",
  testIgnore: ["**/enrollment.spec.ts", "**/buyer-journey.spec.ts"],
  fullyParallel: false,
  forbidOnly: true,
  reporter: [["list"], ["html", { open: "never" }]],
  timeout: 60_000,
  workers: 1,
  use: {
    baseURL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: fullStackProjects[0],
      use: {
        browserName: "chromium",
        viewport: { width: 1_440, height: 1_024 },
      },
    },
    {
      name: fullStackProjects[1],
      use: {
        browserName: "chromium",
        hasTouch: true,
        isMobile: true,
        viewport: { width: 390, height: 844 },
      },
    },
  ],
});
