import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "contracts",
    include: ["test/contracts/**/*.test.ts"],
    maxWorkers: 2,
    restoreMocks: true,
  },
});
