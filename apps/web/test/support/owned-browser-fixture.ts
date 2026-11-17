import type { ChildProcess } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import {
  chromium,
  webkit,
  type Browser,
  type BrowserServer,
} from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
import { z } from "zod";
import { spawnOwned, stopOwned } from "../../../../scripts/owned-process.mjs";

const fixtureName = z.enum([
  "term-deck",
  "body-fragments",
  "reader-history",
  "cabinet-facts",
  "course-film",
  "material-video",
  "native-dialog",
  "account-avatar",
]);
const budget = z.number().int().positive().max(30_000);
const configuration = z.object({
  name: fixtureName,
  startupTimeoutMs: budget.default(30_000),
  browserLaunchTimeoutMs: budget.default(30_000),
  browserExecutablePath: z.string().min(1).optional(),
});
type Configuration = z.infer<typeof configuration>;
const loopbackHttp = z.url().refine((value) => {
  const url = new URL(value);
  return url.protocol === "http:" && url.hostname === "127.0.0.1";
});
const loopbackWebSocket = z.url().refine((value) => {
  const url = new URL(value);
  return url.protocol === "ws:" && url.hostname === "127.0.0.1";
});
const message = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("ready"),
    url: loopbackHttp,
    endpoints: z.object({
      chromium: loopbackWebSocket,
      webkit: loopbackWebSocket,
    }),
  }),
  z.object({ kind: z.literal("failed"), message: z.string().max(4_096) }),
]);
type Ready = Extract<z.infer<typeof message>, { kind: "ready" }>;
const prefix = "inside-owned-browser-fixture:";
const engines = { chromium, webkit };
const stopGraceMs = 1_000;
const disconnectBudgetMs = 5_000;
const entry = fileURLToPath(import.meta.url);
const webRoot = fileURLToPath(new URL("../../", import.meta.url));

export interface BrowserFixture {
  readonly url: string;
  readonly browsers: ReadonlyMap<string, Browser>;
}

/** The supervisor owns Vite and browser processes before either API can return a handle. */
export function createOwnedBrowserFixture(
  name: z.infer<typeof fixtureName>,
  options: Omit<z.input<typeof configuration>, "name"> = {},
) {
  const config = configuration.parse({ name, ...options });
  const clients = new Map<string, Browser>();
  const abort = new AbortController();
  let host: ChildProcess | undefined;
  let starting: Promise<BrowserFixture> | undefined;
  let stoppedHost: Promise<void> | undefined;
  let closing: Promise<void> | undefined;
  let closed = false;

  const stopHost = () => {
    stoppedHost ??=
      host === undefined ? Promise.resolve() : stopOwned(host, stopGraceMs);
    return stoppedHost;
  };
  const disconnectClients = async () => {
    for (const browser of clients.values()) {
      if (!browser.isConnected()) continue;
      await new Promise<void>((resolve, reject) => {
        const done = () => {
          clearTimeout(timer);
          browser.off("disconnected", done);
          resolve();
        };
        // deterministic-test-allow duration-wait: bounds the supervised browser's transport shutdown.
        const timer = setTimeout(() => {
          browser.off("disconnected", done);
          reject(new Error("Owned browser transport did not disconnect"));
        }, disconnectBudgetMs);
        browser.once("disconnected", done);
        if (!browser.isConnected()) done();
      });
    }
  };
  const run = async (): Promise<BrowserFixture> => {
    const deadline = performance.now() + config.startupTimeoutMs;
    host = spawnOwned(
      process.execPath,
      [entry, "--owned-browser-fixture-host", JSON.stringify(config)],
      {
        cwd: webRoot,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const ready = await readReady(host, abort.signal, config.startupTimeoutMs);
    for (const engine of ["chromium", "webkit"] as const) {
      if (closed) throw new Error("Browser fixture is closed");
      const remaining = deadline - performance.now();
      if (remaining <= 0)
        throw new Error("Owned browser fixture startup deadline exceeded");
      const browser = await engines[engine].connect(ready.endpoints[engine], {
        timeout: remaining,
      });
      clients.set(engine, browser);
    }
    if (closed) throw new Error("Browser fixture is closed");
    return { url: ready.url, browsers: clients };
  };

  return {
    start: () => {
      if (closed) return Promise.reject(new Error("Browser fixture is closed"));
      starting ??= run().catch(async (error: unknown) => {
        await stopHost();
        await disconnectClients();
        throw error;
      });
      return starting;
    },
    close: () => {
      if (closing !== undefined) return closing;
      closed = true;
      abort.abort();
      closing = (async () => {
        const stopping = stopHost();
        await Promise.all([stopping, starting?.catch(() => undefined)]);
        await disconnectClients();
      })();
      return closing;
    },
  };
}

function readReady(
  host: ChildProcess,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<Ready> {
  return new Promise((resolve, reject) => {
    if (host.stdout === null) {
      reject(new Error("Browser fixture has no output pipe"));
      return;
    }
    const lines = createInterface({ input: host.stdout });
    let settled = false;
    let stderr = "";
    const capture = (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-8_192);
    };
    const finish = (error?: Error, ready?: Ready) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      host.off("error", onError);
      host.off("exit", onExit);
      host.stderr?.off("data", capture);
      lines.close();
      if (error !== undefined) reject(error);
      else if (ready !== undefined) resolve(ready);
    };
    const onError = (error: Error) => {
      finish(error);
    };
    const onExit = (code: number | null) => {
      finish(
        new Error(
          `Browser fixture exited before readiness (${String(code)}): ${stderr}`,
        ),
      );
    };
    const onAbort = () => {
      finish(new Error("Browser fixture is closed"));
    };
    // deterministic-test-allow duration-wait: bounds readiness of the owned Vite/browser command tree.
    const timer = setTimeout(() => {
      finish(new Error("Owned browser fixture startup deadline exceeded"));
    }, timeoutMs);
    lines.on("line", (line: string) => {
      if (!line.startsWith(prefix)) return;
      if (line.length > 16_384) {
        finish(new Error("Browser fixture message exceeds its bound"));
        return;
      }
      try {
        const value: unknown = JSON.parse(line.slice(prefix.length));
        const result = message.parse(value);
        if (result.kind === "failed") finish(new Error(result.message));
        else finish(undefined, result);
      } catch (error) {
        finish(
          error instanceof Error
            ? error
            : new Error("Invalid browser fixture message"),
        );
      }
    });
    host.stderr?.on("data", capture);
    host.once("error", onError);
    host.once("exit", onExit);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}

/** This entry shares the protocol schema; its whole command tree is supervised by the caller. */
async function runHost(config: Configuration) {
  let server: ViteDevServer | undefined;
  const browsers: BrowserServer[] = [];
  let closed = false;
  const isClosed = () => closed;
  let closing: Promise<void> | undefined;
  const close = () => {
    closed = true;
    closing ??= Promise.allSettled([
      ...browsers.map((browser) => browser.close()),
      ...(server === undefined ? [] : [server.close()]),
    ]).then(() => undefined);
    return closing;
  };
  const stop = () => {
    void close().then(() => {
      process.exit(0);
    });
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  try {
    const historyPage =
      config.name === "reader-history"
        ? await readFile(
            new URL("./reader-history.html", import.meta.url),
            "utf8",
          )
        : undefined;
    server = await createServer({
      configFile: false,
      plugins:
        historyPage === undefined
          ? []
          : [
              {
                name: "reader-history-pages",
                configureServer(vite) {
                  vite.middlewares.use((request, response, next) => {
                    if (
                      request.url?.startsWith("/materials/") !== true &&
                      request.url?.startsWith("/products/") !== true
                    ) {
                      next();
                      return;
                    }
                    response.setHeader("content-type", "text/html");
                    response.end(historyPage);
                  });
                },
              },
            ],
      root: webRoot,
      cacheDir: `node_modules/.cache/${config.name}-browser`,
      ...(config.name === "body-fragments" ||
      config.name === "cabinet-facts" ||
      config.name === "course-film"
        ? { define: { "process.env": "{}" } }
        : {}),
      resolve: {
        alias: { "@": fileURLToPath(new URL("../../src", import.meta.url)) },
      },
      oxc: { jsx: { runtime: "automatic" } },
      server: { host: "127.0.0.1", port: 0 },
    });
    if (isClosed()) return;
    await server.listen();
    const address = server.httpServer?.address();
    if (
      address === null ||
      address === undefined ||
      typeof address === "string"
    )
      throw new Error("Missing owned fixture listener");
    const endpoints = { chromium: "", webkit: "" };
    for (const engine of ["chromium", "webkit"] as const) {
      if (isClosed()) return;
      const browser = await engines[engine].launchServer({
        host: "127.0.0.1",
        port: 0,
        timeout: config.browserLaunchTimeoutMs,
        ...(config.browserExecutablePath === undefined
          ? {}
          : { executablePath: config.browserExecutablePath }),
      });
      browsers.push(browser);
      endpoints[engine] = browser.wsEndpoint();
    }
    if (isClosed()) return;
    process.stdout.write(
      prefix +
        JSON.stringify({
          kind: "ready",
          url: `http://127.0.0.1:${String(address.port)}/test/support/${config.name}.html`,
          endpoints,
        }) +
        "\n",
    );
  } catch (error) {
    process.stdout.write(
      prefix +
        JSON.stringify({
          kind: "failed",
          message: (error instanceof Error
            ? error.message
            : "Browser fixture failed"
          ).slice(0, 4_096),
        }) +
        "\n",
    );
    await close();
    process.exit(1);
  }
}

if (process.argv[2] === "--owned-browser-fixture-host") {
  const input: unknown = JSON.parse(process.argv[3] ?? "null");
  await runHost(configuration.parse(input));
}
