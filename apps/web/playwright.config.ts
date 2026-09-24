import { defineConfig } from "@playwright/test";

const port = process.env.PLAYWRIGHT_PORT ?? "3100";
const baseURL = `http://127.0.0.1:${port}`;
const captureEvidence = process.env.CAPTURE_EVIDENCE === "1";

export default defineConfig({
  testDir: "./test/e2e",
  testMatch: captureEvidence
    ? "evidence.spec.ts"
    : [
        "account-cabinet.spec.ts",
        "routes.spec.ts",
        "communications.spec.ts",
        "guide-product.spec.ts",
        "guide-purchase.spec.ts",
        "legal.spec.ts",
        "link-indexing.spec.ts",
        "mobile-navigation.spec.ts",
        "subscription.spec.ts",
      ],
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  // Повтор нужен только для следа: тест, прошедший со второй попытки, валит прогон.
  failOnFlakyTests: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    screenshot: "only-on-failure",
    storageState: process.env.EVIDENCE_STORAGE_STATE,
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
  webServer: captureEvidence
    ? {
        command: `pnpm build && pnpm start --hostname 127.0.0.1 --port ${port}`,
        env: {
          BACKEND_BASE_URL:
            process.env.PLAYWRIGHT_BACKEND_BASE_URL ?? "http://127.0.0.1:1",
          /** Публичный адрес площадки читается из конфигурации, а не из заголовка запроса. */
          WEB_BASE_URL: baseURL,
        },
        url: baseURL,
        reuseExistingServer: false,
        stdout: "ignore",
        stderr: "pipe",
        timeout: 300_000,
      }
    : {
        // Проверки идут на production-сборке: dev компилирует маршрут при первом открытии, и
        // время ответа меряло бы машину. Лаунчер собирает web, если сборку не передали готовой.
        command: "node test/support/production-web.mjs",
        env: {
          PRODUCTION_WEB_BACKEND_URL:
            process.env.PLAYWRIGHT_BACKEND_BASE_URL ?? "http://127.0.0.1:1",
          PRODUCTION_WEB_PORT: port,
        },
        // Лаунчер убирает за собой идентичность выпуска, поэтому ему нужен сигнал, а не SIGKILL.
        gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
        url: `${baseURL}/_health/live`,
        reuseExistingServer: false,
        stdout: "ignore",
        stderr: "pipe",
        timeout: 300_000,
      },
});
