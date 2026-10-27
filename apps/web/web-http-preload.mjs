// @ts-check
// Runs before Next creates its HTTP server. Instrumentation.register is too late for
// a request queued during Next's asynchronous config/handler initialization.
import { lookup } from "node:dns/promises";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolveRuntimeIdentity } from "@inside/runtime-identity";
import { z } from "zod";
import {
  parseWebHttpMetricsConfig,
  webHttpSourceReadyKey,
} from "./server/http-metrics-config.ts";
import {
  startWebHttpMetrics,
  webHttpRoutes,
} from "./server/web-http-metrics.ts";

const config = parseWebHttpMetricsConfig(process.env, "production");
if (config.enabled) {
  // The generated standalone entry sets this same application directory itself.
  process.chdir(fileURLToPath(new URL(".", import.meta.url)));
  const identity = resolveRuntimeIdentity({
    environment: process.env,
    mode: "production",
  });
  const manifest = new URL(".next/routes-manifest.json", import.meta.url);
  const information = await stat(manifest);
  if (!information.isFile() || information.size > 256 * 1024)
    throw new Error("web_http_route_manifest");
  /** @type {unknown} */
  const raw = JSON.parse(await readFile(manifest, "utf8"));
  const { address } = await lookup("inside-web-http", { family: 4 });
  const host = z
    .ipv4()
    .refine((value) => {
      const [first, second] = value.split(".").map(Number);
      return (
        first === 127 ||
        first === 10 ||
        (first === 172 &&
          second !== undefined &&
          second >= 16 &&
          second <= 31) ||
        (first === 192 && second === 168)
      );
    })
    .parse(address);
  const source = await startWebHttpMetrics({
    applicationPort: config.applicationPort,
    host,
    port: 9420,
    routes: webHttpRoutes(raw),
    sourceSha: identity.sourceSha,
    environment: config.environment,
  });
  Reflect.set(globalThis, webHttpSourceReadyKey, true);
  const stop = () => {
    Reflect.set(globalThis, webHttpSourceReadyKey, false);
    void source.stop().catch(() => {
      process.exitCode = 1;
    });
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}
