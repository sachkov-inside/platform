import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["test/integration/migration-clock.setup.ts"],
    fileParallelism: false,
    include: ["test/integration/**/*.test.ts"],
    sequence: {
      concurrent: false,
    },
  },
});
