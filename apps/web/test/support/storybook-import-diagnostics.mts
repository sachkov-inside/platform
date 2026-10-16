import { appendFileSync, mkdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import {
  playwright,
  PlaywrightBrowserProvider,
  type PlaywrightProviderOptions,
} from "@vitest/browser-playwright";
import type { Page, Request } from "@playwright/test";
import { createLogger, type Logger, type Plugin } from "vite";

const bodyByteLimit = 64 * 1024;
const reportByteLimit = 1024 * 1024;

/** Bound decoded UTF-8 too: an incomplete code point otherwise expands into a replacement character. */
function limitedText(value: string) {
  const bytes = Buffer.from(value);
  let text = bytes.subarray(0, bodyByteLimit).toString("utf8");
  if (Buffer.byteLength(text) > bodyByteLimit) text = text.slice(0, -1);
  return {
    text,
    originalBytes: bytes.length,
    truncated: bytes.length > Buffer.byteLength(text),
  };
}

/** Node-side capture also covers imports that prevent all browser setup files from running. */
export function storybookImportDiagnostics(
  directory = resolve("test-results/storybook-imports"),
) {
  let report: string | undefined;
  let reportedLimit = false;
  let reportedWriteError = false;

  function record(event: Record<string, unknown>) {
    try {
      if (report === undefined) {
        mkdirSync(directory, { recursive: true });
        const runDirectory = join(
          directory,
          `run-${String(process.pid)}-${String(Math.trunc(performance.timeOrigin))}`,
        );
        mkdirSync(runDirectory, { recursive: true });
        report = join(runDirectory, "imports.jsonl");
        console.error(`[storybook-imports] ${report}`);
      }
      if (reportedLimit) return;
      let line = `${JSON.stringify({ monotonicMilliseconds: performance.now(), pid: process.pid, ...event })}\n`;
      const writtenBytes =
        statSync(report, { throwIfNoEntry: false })?.size ?? 0;
      if (writtenBytes + Buffer.byteLength(line) > reportByteLimit - 128) {
        line = `${JSON.stringify({ kind: "capture-limit", reportByteLimit })}\n`;
        reportedLimit = true;
        if (writtenBytes + Buffer.byteLength(line) > reportByteLimit) return;
      }
      appendFileSync(report, line, { mode: 0o600 });
    } catch (error) {
      if (!reportedWriteError) {
        reportedWriteError = true;
        console.error(
          "[storybook-imports] Could not retain diagnostics:",
          error,
        );
      }
    }
  }

  function observe(page: Page, origin: string, sessionId: string) {
    const failedResponses = new WeakMap<Request, number>();
    function localScript(request: Request) {
      const url = new URL(request.url());
      return url.origin === origin && request.resourceType() === "script";
    }
    function requestUrl(request: Request) {
      const url = new URL(request.url());
      // Keep Vite's import/cache identities; omit unrelated query values and credentials.
      const parameters = new URLSearchParams();
      for (const key of ["v", "t", "import", "browserv"]) {
        const value = url.searchParams.get(key);
        if (value !== null) parameters.set(key, value);
      }
      url.search = parameters.toString();
      url.hash = "";
      url.username = "";
      url.password = "";
      return url.href;
    }
    page.on("response", (response) => {
      const request = response.request();
      if (!localScript(request) || response.status() < 400) return;
      failedResponses.set(request, response.status());
      record({
        kind: "http-response",
        sessionId,
        url: requestUrl(request),
        status: response.status(),
        contentType: response.headers()["content-type"],
      });
    });
    page.on("requestfailed", (request) => {
      if (!localScript(request)) return;
      record({
        kind: "transport-failure",
        status: failedResponses.get(request),
        sessionId,
        url: requestUrl(request),
        error: request.failure()?.errorText ?? "unknown transport failure",
      });
    });
  }

  const plugin: Plugin = {
    name: "inside:storybook-import-diagnostics",
    config(config) {
      const logger =
        config.customLogger ??
        createLogger(config.logLevel, {
          allowClearScreen: config.clearScreen ?? true,
        });
      const capturedLogger: Logger = {
        ...logger,
        get hasWarned() {
          return logger.hasWarned;
        },
        set hasWarned(value) {
          logger.hasWarned = value;
        },
        error(message, options) {
          const capturedMessage = limitedText(message);
          const stack = options?.error?.stack;
          const capturedStack =
            stack === undefined ? undefined : limitedText(stack);
          record({
            kind: "server-error",
            message: capturedMessage.text,
            messageBytes: capturedMessage.originalBytes,
            messageTruncated: capturedMessage.truncated,
            error: capturedStack?.text,
            errorBytes: capturedStack?.originalBytes,
            errorTruncated: capturedStack?.truncated,
          });
          logger.error(message, options);
        },
      };
      return { customLogger: capturedLogger };
    },
    configureServer(server) {
      // Chromium may discard a failed module response body. Observe the original Vite output,
      // without making a second request or changing its status, bytes, callbacks or backpressure.
      server.middlewares.use((request, response, next) => {
        if (request.headers["sec-fetch-dest"] !== "script") {
          next();
          return;
        }
        const chunks: Buffer[] = [];
        let bodyBytes = 0;
        let retainedBytes = 0;
        function capture(chunk: unknown, encoding?: unknown) {
          if (response.statusCode < 400) return;
          const bytes =
            typeof chunk === "string"
              ? Buffer.from(
                  chunk,
                  typeof encoding === "string" && Buffer.isEncoding(encoding)
                    ? encoding
                    : "utf8",
                )
              : chunk instanceof Uint8Array
                ? Buffer.from(chunk)
                : undefined;
          if (bytes === undefined) return;
          bodyBytes += bytes.length;
          const retained = bytes.subarray(
            0,
            Math.max(0, bodyByteLimit - retainedBytes),
          );
          if (retained.length > 0) chunks.push(Buffer.from(retained));
          retainedBytes += retained.length;
        }
        const write = response.write.bind(response);
        response.write = (
          chunk: unknown,
          encodingOrCallback?:
            BufferEncoding | ((error?: Error | null) => void),
          callback?: (error?: Error | null) => void,
        ) => {
          capture(chunk, encodingOrCallback);
          return typeof encodingOrCallback === "function"
            ? write(chunk, encodingOrCallback)
            : encodingOrCallback === undefined
              ? write(chunk, callback)
              : write(chunk, encodingOrCallback, callback);
        };
        const end = response.end.bind(response);
        response.end = (
          chunk?: unknown,
          encodingOrCallback?: BufferEncoding | (() => void),
          callback?: () => void,
        ) => {
          if (typeof chunk === "function") return end(chunk);
          capture(chunk, encodingOrCallback);
          return typeof encodingOrCallback === "function"
            ? end(chunk, encodingOrCallback)
            : encodingOrCallback === undefined
              ? end(chunk, callback)
              : end(chunk, encodingOrCallback, callback);
        };
        let reportedResponse = false;
        function retainResponse(complete: boolean) {
          if (reportedResponse || response.statusCode < 400) return;
          reportedResponse = true;
          const body = limitedText(Buffer.concat(chunks).toString("utf8"));
          const url = new URL(request.url ?? "/", "http://localhost");
          url.search = "";
          record({
            kind: "http-body",
            path: url.pathname,
            status: response.statusCode,
            body: body.text,
            complete,
            bodyBytes,
            truncated: bodyBytes > retainedBytes || body.truncated,
          });
        }
        response.once("finish", () => {
          retainResponse(true);
        });
        response.once("close", () => {
          retainResponse(response.writableFinished);
        });
        next();
      });
    },
  };
  const options: PlaywrightProviderOptions = {
    contextOptions: { reducedMotion: "reduce" },
  };
  const provider = {
    ...playwright(options),
    providerFactory(
      project: ConstructorParameters<typeof PlaywrightBrowserProvider>[0],
    ) {
      return new (class extends PlaywrightBrowserProvider {
        override async openPage(
          sessionId: string,
          url: string,
          openOptions: { parallel: boolean },
        ) {
          // Public provider hooks create the page before any Vite navigation or setup import.
          await super.openPage(sessionId, "about:blank", openOptions);
          const page = this.getPage(sessionId);
          observe(page, new URL(url).origin, sessionId);
          await page.goto(url, { timeout: 0 });
        }
      })(project, options);
    },
  };
  return { plugin, provider };
}
