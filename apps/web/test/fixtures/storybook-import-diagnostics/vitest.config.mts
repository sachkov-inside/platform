import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { runScopedViteCache } from "../../support/run-scoped-vite-cache.mjs";

import { storybookImportDiagnostics } from "../../support/storybook-import-diagnostics.mjs";

const diagnostics = storybookImportDiagnostics(
  process.env["INSIDE_IMPORT_PROBE_OUTPUT"],
);
const mode = process.env["INSIDE_IMPORT_PROBE_MODE"];
const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root,
  plugins: [
    runScopedViteCache(),
    diagnostics.plugin,
    {
      name: "controlled-import-failure",
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          if (
            (mode === "http-partial" || mode === "http-utf8") &&
            (request.url?.includes("setup-dependency.ts") ?? false)
          ) {
            response.statusCode = 500;
            response.setHeader("Content-Type", "text/javascript");
            if (mode === "http-utf8") {
              response.end("a".repeat(65535) + "€");
            } else {
              response.setHeader("Content-Length", "100000");
              response.flushHeaders();
              response.write("controlled-partial-body", () => {
                response.destroy();
              });
            }
            return;
          }
          if (
            mode === "transport" &&
            (request.url?.includes("setup-dependency.ts") ?? false)
          ) {
            request.socket.destroy();
            return;
          }
          next();
        });
      },
      transform(_source, id) {
        const target =
          mode === "http-story" ? "story-dependency.ts" : "setup-dependency.ts";
        if (
          (mode?.startsWith("http") ?? false) &&
          mode !== "http-partial" &&
          mode !== "http-utf8" &&
          id.endsWith(target)
        ) {
          throw new Error(
            `controlled-vite-transform-failure${mode === "http-large" ? "x".repeat(100000) : ""}`,
          );
        }
      },
    },
  ],
  test: {
    name: "import-probe",
    include: ["probe.test.ts"],
    setupFiles: ["./setup.ts"],
    browser: {
      enabled: true,
      headless: true,
      provider: diagnostics.provider,
      instances: [{ browser: "chromium" }],
    },
  },
});
