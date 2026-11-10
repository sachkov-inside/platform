import { defineConfig } from "vitest/config";

// Browser checks of the Trainer widget. They need Playwright's Chromium, which the Telegram
// CI job does not install, so they run by `pnpm --filter @inside/telegram test:widget` and
// are not part of `check`.
export default defineConfig({
  test: {
    maxWorkers: 1,
    coverage: {
      enabled: false,
    },
    include: ["test/widget/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
