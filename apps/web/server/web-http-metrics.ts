import { channel } from "node:diagnostics_channel";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { performance } from "node:perf_hooks";
import { z } from "zod";

const routeSchema = z.object({
  page: z
    .string()
    .max(200)
    .regex(/^\/[A-Za-z0-9_./\-[\]]*$/u),
  regex: z.string().max(2048).startsWith("^").endsWith("$"),
});
const manifestSchema = z.object({
  staticRoutes: z.array(routeSchema).max(512),
  dynamicRoutes: z.array(routeSchema).max(512),
});
const requestSchema = z.object({
  request: z.instanceof(IncomingMessage),
  response: z.instanceof(ServerResponse),
});
const METHODS = new Set([
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
  "CONNECT",
  "TRACE",
]);
const BUCKETS = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
] as const;
const MAX_GROUPS = 1024;
const MAX_METRICS_BYTES = 2 * 1024 * 1024;
interface Route {
  page: string;
  pattern: RegExp;
}
interface Duration {
  count: number;
  sum: number;
  buckets: number[];
}

/** Build-owned Next routes only; caller URLs never become label values. */
export function webHttpRoutes(manifest: unknown): readonly Route[] {
  const parsed = manifestSchema.parse(manifest);
  return [...parsed.staticRoutes, ...parsed.dynamicRoutes].map(
    ({ page, regex }) => ({ page, pattern: new RegExp(regex) }),
  );
}

/** Observe the real Node response lifetime. No request/response method is patched. */
export async function startWebHttpMetrics(options: {
  applicationPort: number;
  host: string;
  port: number;
  routes: readonly Route[];
  sourceSha: string;
  environment: "test" | "isolated-pilot" | "production";
}): Promise<{ port: number; stop: () => Promise<void> }> {
  const sha = z
    .string()
    .regex(/^[a-f0-9]{40}$/u)
    .parse(options.sourceSha);
  const active = new Map<string, number>();
  const started = new Map<string, number>();
  const durations = new Map<string, Duration>();
  const pending = new Set<() => void>();
  let overflow = false;
  let sourceInvalid = false;
  const processStart = performance.timeOrigin / 1000;
  const environment = z
    .enum(["test", "isolated-pilot", "production"])
    .parse(options.environment);
  const base = `service="platform-web",environment="${environment}",source_sha="${sha}"`;
  const source = base;
  const observed = channel("http.server.request.start");
  const onRequest = (message: unknown): void => {
    const parsed = requestSchema.safeParse(message);
    if (!parsed.success) {
      sourceInvalid = true;
      return;
    }
    const { request, response } = parsed.data;
    if (request.socket.localPort !== options.applicationPort) return;
    const path = (request.url ?? "").split(/[?#]/u, 1)[0] ?? "";
    const route =
      path.length <= 8192
        ? (options.routes.find(({ pattern }) => pattern.test(path))?.page ??
          (path.startsWith("/_next/static/") ? "_static" : "_unmatched"))
        : "_unmatched";
    const method = METHODS.has(request.method ?? "")
      ? (request.method ?? "OTHER")
      : "OTHER";
    const labels = `${base},route=${JSON.stringify(route)},method="${method}"`;
    const begin = performance.now();
    started.set(labels, (started.get(labels) ?? 0) + 1);
    active.set(labels, (active.get(labels) ?? 0) + 1);
    let settled = false;
    const detach = (): void => {
      response.off("finish", finish);
      response.off("close", close);
      pending.delete(detach);
    };
    const end = (outcome: "completed" | "aborted"): void => {
      if (settled) return;
      settled = true;
      detach();
      active.set(labels, (active.get(labels) ?? 1) - 1);
      const code =
        response.headersSent &&
        response.statusCode >= 100 &&
        response.statusCode <= 599
          ? response.statusCode
          : 0;
      const key = `${labels},code="${String(code)}",outcome="${outcome}"`;
      let duration = durations.get(key);
      if (duration === undefined) {
        if (durations.size >= MAX_GROUPS) {
          overflow = true;
          return;
        }
        duration = { count: 0, sum: 0, buckets: BUCKETS.map(() => 0) };
        durations.set(key, duration);
      }
      const seconds = (performance.now() - begin) / 1000;
      duration.count += 1;
      duration.sum += seconds;
      BUCKETS.forEach((bound, index) => {
        if (seconds <= bound)
          duration.buckets[index] = (duration.buckets[index] ?? 0) + 1;
      });
    };
    const finish = (): void => {
      end("completed");
    };
    const close = (): void => {
      end(response.writableFinished ? "completed" : "aborted");
    };
    response.once("finish", finish);
    response.once("close", close);
    pending.add(detach);
  };
  const server = createServer(
    { requestTimeout: 1000, headersTimeout: 1000, keepAliveTimeout: 1000 },
    (request, response) => {
      if (request.method !== "GET" || request.url !== "/metrics") {
        response.writeHead(404).end();
        return;
      }
      const rows = [
        "# TYPE inside_web_http_started_total counter",
        "# TYPE inside_web_http_requests_total counter",
        "# TYPE inside_web_http_active_requests gauge",
        "# TYPE inside_web_http_duration_seconds histogram",
        `inside_web_http_source_info{${source}} 1`,
        `inside_web_http_process_start_time_seconds{${base}} ${String(processStart)}`,
        // deterministic-test-allow wall-clock: timestamp of this real source read, never a cached success.
        `inside_web_http_observed_at_seconds{${base}} ${String(Date.now() / 1000)}`,
        `inside_web_http_registry_overflow{${base}} ${overflow ? "1" : "0"}`,
      ];
      for (const [labels, value] of started)
        rows.push(`inside_web_http_started_total{${labels}} ${String(value)}`);
      for (const [labels, value] of active)
        rows.push(
          `inside_web_http_active_requests{${labels}} ${String(value)}`,
        );
      for (const [labels, value] of durations) {
        rows.push(
          `inside_web_http_requests_total{${labels}} ${String(value.count)}`,
        );
        BUCKETS.forEach((bound, index) =>
          rows.push(
            `inside_web_http_duration_seconds_bucket{${labels},le="${String(bound)}"} ${String(value.buckets[index] ?? 0)}`,
          ),
        );
        rows.push(
          `inside_web_http_duration_seconds_bucket{${labels},le="+Inf"} ${String(value.count)}`,
          `inside_web_http_duration_seconds_count{${labels}} ${String(value.count)}`,
          `inside_web_http_duration_seconds_sum{${labels}} ${String(value.sum)}`,
        );
      }
      const body = rows.join("\n") + "\n";
      if (
        sourceInvalid ||
        overflow ||
        Buffer.byteLength(body) > MAX_METRICS_BYTES
      ) {
        response.writeHead(503).end();
        return;
      }
      response
        .writeHead(200, {
          "Content-Type": "text/plain; version=0.0.4",
          "Cache-Control": "no-store",
        })
        .end(body);
    },
  );
  server.maxConnections = 8;
  server.maxRequestsPerSocket = 1;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  observed.subscribe(onRequest);
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("metrics_address");
  let stopping: Promise<void> | undefined;
  const stop = (): Promise<void> => {
    stopping ??= new Promise<void>((resolve, reject) => {
      observed.unsubscribe(onRequest);
      for (const detach of pending) detach();
      server.closeAllConnections();
      server.close((error) => {
        if (error === undefined) resolve();
        else reject(error);
      });
    });
    return stopping;
  };
  return { port: address.port, stop };
}
