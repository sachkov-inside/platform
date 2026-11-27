import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  optimizeDeps: {
    include: ["@tanstack/react-query", "zod"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "next/cache": fileURLToPath(
        new URL("./test/support/next-cache.ts", import.meta.url),
      ),
      "server-only": fileURLToPath(
        new URL("./test/support/server-only.ts", import.meta.url),
      ),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "module",
          maxWorkers: 2,
          environment: "node",
          include: ["test/module/**/*.test.ts"],
          // The actual Logto SDK uses Next's extensionless imports through Vite.
          // Request stores and cookies stay real in the owned request scope.
          server: { deps: { inline: ["@logto/next"] } },
          restoreMocks: true,
          setupFiles: ["./test/support/request-scope.ts"],
          unstubEnvs: true,
          unstubGlobals: true,
        },
      },
      {
        extends: true,
        test: {
          name: "contracts",
          maxWorkers: 2,
          environment: "node",
          include: ["test/contracts/**/*.test.ts"],
          // The real HTTP transport imports Logto's extensionless Next.js entrypoint through Vite.
          server: { deps: { inline: ["@logto/next"] } },
          restoreMocks: true,
          unstubEnvs: true,
          unstubGlobals: true,
        },
      },
      {
        // Проверки, которые сами запускают настоящие движки браузеров (Chromium и WebKit): им нужны
        // установленные браузеры и отдельный запуск.
        extends: true,
        test: {
          name: "browser-engines",
          maxWorkers: 2,
          environment: "node",
          include: ["test/browser-engines/**/*.test.ts"],
          restoreMocks: true,
          unstubEnvs: true,
          unstubGlobals: true,
        },
      },
    ],
  },
});
