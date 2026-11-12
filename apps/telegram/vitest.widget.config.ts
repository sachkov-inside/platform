import { defineConfig } from "vitest/config";

// Browser checks of the Trainer widget. They need Playwright's Chromium and WebKit, which the
// Telegram CI job does not install, so they run by `pnpm --filter @inside/telegram test:widget`
// inside `pnpm check:ui`, the «UI components» CI job. On Linux the harness pins the default
// font through `test/widget/fonts.conf` (#2026).
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
