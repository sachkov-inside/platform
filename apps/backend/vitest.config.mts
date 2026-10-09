import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    maxWorkers: 1,
    include: ["test/**/*.test.ts"],
    exclude: [
      "test/**/*.smoke.test.ts",
      "test/integration/**/*.test.ts",
      "test/contracts/**/*.test.ts",
    ],
  },
});
