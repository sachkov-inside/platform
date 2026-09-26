import { defineConfig } from "@playwright/test";

const webPort = process.env.NAVIGATION_WEB_PORT ?? "3180";
const backendPort = process.env.FAKE_BACKEND_PORT ?? "3190";
const baseURL = `http://127.0.0.1:${webPort}`;

/**
 * Переходы проверяются на production-сборке с подставным backend (#670): в dev нет предзагрузки
 * ссылок, а маршруты компилируются при первом открытии, поэтому dev ничего не говорит о скорости.
 */
export default defineConfig({
  testDir: "./test/navigation",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  // Повтор нужен только для следа: тест, прошедший со второй попытки, валит прогон.
  failOnFlakyTests: Boolean(process.env.CI),
  reporter: [["list"]],
  retries: process.env.CI ? 1 : 0,
  workers: 1,
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
  webServer: [
    {
      command: "node test/navigation/fake-backend.mjs",
      env: { FAKE_BACKEND_PORT: backendPort },
      reuseExistingServer: false,
      url: `http://127.0.0.1:${backendPort}/__requests`,
    },
    {
      command: "node test/support/production-web.mjs",
      env: {
        PRODUCTION_WEB_BACKEND_URL: `http://127.0.0.1:${backendPort}`,
        PRODUCTION_WEB_PORT: webPort,
      },
      // Лаунчер убирает за собой идентичность выпуска, поэтому ему нужен сигнал, а не SIGKILL.
      gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
      reuseExistingServer: false,
      stderr: "pipe",
      stdout: "ignore",
      timeout: 300_000,
      url: `${baseURL}/_health/live`,
    },
  ],
});
