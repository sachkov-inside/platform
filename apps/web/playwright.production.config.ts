import { defineConfig } from "@playwright/test";

import { productionTarget } from "./test/production/pass-config";

/**
 * Production-проход доступа (#905) против настоящего production: данные Platform не меняет. Запускается вручную
 * через workflow `Production access pass`; это не проверка pull request.
 * `PRODUCTION_ACCESS_BROWSER_PROXY` нужен только локально, когда сеть идёт через proxy.
 */
const browserProxy = process.env["PRODUCTION_ACCESS_BROWSER_PROXY"];

export default defineConfig({
  testDir: "./test/production",
  testMatch: "**/*.spec.ts",
  globalSetup: "./test/production/pass-setup.ts",
  globalTeardown: "./test/production/pass-report.ts",
  fullyParallel: false,
  forbidOnly: true,
  reporter: "list",
  retries: 0,
  timeout: 180_000,
  workers: 1,
  use: {
    baseURL: productionTarget.web,
    navigationTimeout: 60_000,
    actionTimeout: 30_000,
    screenshot: "off",
    trace: "off",
    video: "off",
    ...(browserProxy === undefined ? {} : { proxy: { server: browserProxy } }),
  },
  projects: [{ name: "production", use: { browserName: "chromium" } }],
});
