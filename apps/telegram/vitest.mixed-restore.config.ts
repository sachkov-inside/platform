import { defineConfig } from "vitest/config";

/** This test owns its server and databases; the shared integration database setup is unrelated. */
export default defineConfig({
  test: {
    include: [
      "test/integration/domain-model-mixed-restore.integration.test.ts",
    ],
    fileParallelism: false,
    hookTimeout: 60_000,
  },
});
