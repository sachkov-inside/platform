import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(
        new URL("./test/support/server-only.ts", import.meta.url),
      ),
      "next/cache": fileURLToPath(
        new URL("./test/support/next-cache.ts", import.meta.url),
      ),
    },
  },
  test: {
    include: ["test/native-analytics/**/*.test.ts"],
    environment: "node",
    maxWorkers: 1,
    testTimeout: 45_000,
    hookTimeout: 30_000,
    unstubEnvs: true,
    unstubGlobals: true,
  },
});
