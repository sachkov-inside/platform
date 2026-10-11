import { defineConfig } from "vitest/config";

// #461 bounded own-PG corpus. It never starts Testcontainers or selects the shared stand.
export default defineConfig({
  test: {
    globalSetup: ["test/integration/setup/identity-proof.global.ts"],
    include: ["test/integration/telegram-account-sign-in.test.ts"],
    maxWorkers: 1,
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
