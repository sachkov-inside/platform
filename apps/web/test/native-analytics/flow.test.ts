/** Owned Chromium -> production Web operation -> pinned native Umami -> read-only gateway. */
import { readFileSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { chromium, expect as browserExpect } from "@playwright/test";
import { createServer } from "vite";
import { expect, test, vi } from "vitest";

const requestScope = vi.hoisted(() => ({
  baseUrl: "http://127.0.0.1",
  account: "guest",
}));
// Synthetic accepted edition, not a production legal override. Normal runtime remains OFF on v2.
vi.mock("@inside/legal", () => ({
  currentLegalEdition: () => ({ version: 3 }),
}));
vi.mock("@/shared/auth/logto-bff-config.server", () => ({
  readLogtoBffConfig: () => ({ baseUrl: requestScope.baseUrl }),
}));
vi.mock("@/shared/auth/optional-platform-access-token.server", () => ({
  getOptionalPlatformAccessToken: () =>
    Promise.resolve(
      requestScope.account === "guest"
        ? undefined
        : `token-${requestScope.account}`,
    ),
}));
// The existing catalog/read owners are synthetic ports; admission is separately covered by backend owner tests.
vi.mock("@/shared/api/backend/index.server", () => ({
  requestReaderReference: (kind: string, id: string) =>
    Promise.resolve({
      ok: true,
      response: Response.json({}),
      body: { id, kind, availability: "available" },
    }),
  resolveAccount: (token: string) =>
    Promise.resolve({
      accountId:
        token === "token-A"
          ? "20000000-0000-4000-8000-000000000001"
          : "20000000-0000-4000-8000-000000000002",
    }),
}));
import {
  handleAnalyticsCapture,
  handleAnalyticsConfig,
} from "@/features/storage-notice/api/capture.server";

const inputSchema = z.strictObject({
  schema: z.literal(1),
  site: z.uuid(),
  key: z.string().min(32).max(128),
  project: z.string().regex(/^inside-observability-umami-[a-f0-9]{12}$/),
  endpoint: z.string().startsWith("unix:///"),
  compose: z.string().startsWith("/"),
});
// Response fields: pinned v3.4.0 src/queries/sql/events/getWebsiteEvents.ts, relationalQuery.
const eventsSchema = z.object({
  data: z.array(
    z.object({
      id: z.uuid(),
      sessionId: z.uuid(),
      urlPath: z.string(),
      urlQuery: z.string().nullable(),
      eventType: z.number(),
    }),
  ),
});
const expectedPaths = [
  "/products/10000000-0000-4000-8000-000000000001",
  "/products/10000000-0000-4000-8000-000000000002",
  "/materials/10000000-0000-4000-8000-000000000001",
  "/materials/10000000-0000-4000-8000-000000000002",
];

test("two Product and Material observations retain native source codes and remain distinct through the bounded reader", async () => {
  const privateFile = process.env["INSIDE_UMAMI_BROWSER_PROOF_INPUT"];
  if (privateFile === undefined)
    throw new Error(
      "A registered Umami supervisor must supply the private native proof input",
    );
  const input = inputSchema.parse(
    JSON.parse(readFileSync(privateFile, "utf8")),
  );
  const progressFile = process.env["INSIDE_UMAMI_BROWSER_PROOF_PROGRESS"];
  let nativeExportMilliseconds: number | null = null;
  const mark = (
    phase:
      | "started"
      | "listener_ready"
      | "choice_visible"
      | "native_export_started"
      | "native_export_accepted"
      | "native_export_failed"
      | "observations_exported"
      | "native_events_verified"
      | "identity_reset_verified"
      | "revocation_verified",
  ) => {
    if (progressFile !== undefined)
      writeFileSync(
        progressFile,
        JSON.stringify({
          phase,
          native_export_milliseconds: nativeExportMilliseconds,
        }),
        { mode: 0o600 },
      );
  };
  mark("started");
  const originalFetch = globalThis.fetch;
  let nativeCalls = 0;
  vi.stubGlobal("fetch", ((
    target: Parameters<typeof fetch>[0],
    options?: RequestInit,
  ) => {
    if (target !== "http://umami-ingest:3000/api/send")
      return originalFetch(target, options);
    if (typeof options?.body !== "string")
      throw new Error("Native JSON payload required");
    // No acquisition: this exec uses only the source-bound query service owned by the outer pilot.
    mark("native_export_started");
    const started = performance.now();
    let output: string;
    try {
      output = execFileSync(
        "docker",
        [
          "--host",
          input.endpoint,
          "compose",
          "-p",
          input.project,
          "-f",
          input.compose,
          "exec",
          "-T",
          "query",
          "python",
          "/pilot/browser_ingest.py",
        ],
        {
          input: options.body,
          encoding: "utf8",
          timeout: 5_000,
          maxBuffer: 1024,
          env: { PATH: process.env["PATH"], NODE_ENV: process.env.NODE_ENV },
        },
      );
      z.strictObject({ accepted: z.literal(true) }).parse(JSON.parse(output));
    } catch (error) {
      nativeExportMilliseconds = Math.ceil(performance.now() - started);
      mark("native_export_failed");
      throw error;
    }
    nativeExportMilliseconds = Math.ceil(performance.now() - started);
    mark("native_export_accepted");
    nativeCalls++;
    return Promise.resolve(Response.json({}));
  }) satisfies typeof fetch);
  for (const [key, value] of Object.entries({
    INSIDE_ANALYTICS_ENABLED: "true",
    INSIDE_ANALYTICS_LEGAL_REVISION: "3",
    INSIDE_UMAMI_ENDPOINT: "http://umami-ingest:3000/api/send",
    INSIDE_UMAMI_WEBSITE_ID: input.site,
    INSIDE_ANALYTICS_PSEUDONYM_SECRET: "a".repeat(32),
  }))
    vi.stubEnv(key, value);
  function serveAnalytics(incoming: IncomingMessage, outgoing: ServerResponse) {
    void (async () => {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const raw of incoming) {
        const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw));
        size += chunk.byteLength;
        if (size > 1024) {
          outgoing.writeHead(413).end();
          return;
        }
        chunks.push(chunk);
      }
      const headers = new Headers();
      for (const [key, value] of Object.entries(incoming.headers))
        if (typeof value === "string") headers.set(key, value);
      const response =
        incoming.method === "GET"
          ? handleAnalyticsConfig()
          : await handleAnalyticsCapture(
              new Request(requestScope.baseUrl + "/api/analytics", {
                method: "POST",
                headers,
                body: Buffer.concat(chunks),
              }),
            );
      outgoing.writeHead(
        response.status,
        Object.fromEntries(response.headers.entries()),
      );
      outgoing.end(await response.text());
    })().catch(() => {
      outgoing.writeHead(500).end();
    });
  }
  const server = await createServer({
    configFile: false,
    plugins: [
      {
        name: "owned-analytics-operation",
        configureServer(server) {
          server.middlewares.use("/api/analytics", serveAnalytics);
        },
      },
    ],
    define: { "process.env": "{}" },
    cacheDir: "node_modules/.cache/native-analytics",
    root: fileURLToPath(new URL("../../", import.meta.url)),
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("../../src", import.meta.url)),
        "next/link": fileURLToPath(
          new URL("../../.storybook/mocks/next-link.tsx", import.meta.url),
        ),
      },
    },
    oxc: { jsx: { runtime: "automatic" } },
    server: { host: "127.0.0.1", port: 0 },
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;

  try {
    await server.listen();
    const address = server.httpServer?.address();
    if (
      address === null ||
      address === undefined ||
      typeof address === "string"
    )
      throw new Error("Native browser listener absent");
    requestScope.baseUrl = `http://127.0.0.1:${String(address.port)}`;
    mark("listener_ready");
    browser = await chromium.launch();
    const page = await browser.newPage({
      userAgent:
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36",
    });
    await page.goto(
      requestScope.baseUrl +
        "/test/support/analytics-flow.html?utm_source=telegram&email=sentinel@example.com#gclid=sentinel",
      { referer: "https://t.me/private-sentinel?token=sentinel" },
    );
    await browserExpect(
      page.getByRole("region", { name: "Cookies и аналитика" }),
    ).toBeVisible();
    mark("choice_visible");
    expect(nativeCalls).toBe(0);
    const accepted = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/analytics") &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Разрешить", exact: true }).click();
    expect((await accepted).status()).toBe(200);
    for (const name of [
      "Второй продукт",
      "Открыть материал",
      "Второй материал",
    ]) {
      const captured = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/analytics") &&
          response.request().method() === "POST",
      );
      await page.getByRole("button", { name, exact: true }).click();
      expect((await captured).status()).toBe(200);
    }
    mark("observations_exported");
    let rows: z.infer<typeof eventsSchema>["data"] = [];
    let rawEvents: unknown;
    await browserExpect
      .poll(
        async () => {
          // deterministic-test-allow wall-clock: the pinned native Umami real-clock HTTP boundary owns these event timestamps.
          const now = Date.now();
          const path = `http://127.0.0.1:13301/api/websites/${input.site}/events?startAt=${String(now - 60_000)}&endAt=${String(now)}&page=1&pageSize=100`;
          const response = await originalFetch(path, {
            headers: { authorization: `Bearer ${input.key}` },
            signal: AbortSignal.timeout(3000),
          });
          if (!response.ok)
            throw new Error("Native reader refused the owned proof");
          rawEvents = await response.json();
          rows = eventsSchema.parse(rawEvents).data;
          return expectedPaths.every((path) =>
            rows.some((row) => row.urlPath === path),
          );
        },
        { timeout: 10_000 },
      )
      .toBe(true);
    for (const path of expectedPaths) {
      const matched = rows.filter((row) => row.urlPath === path);
      expect(matched).toHaveLength(1);
      expect(matched[0]?.eventType).toBe(1);
      expect(matched[0]?.urlQuery).toBe(
        "utm_source=telegram&utm_medium=telegram",
      );
    }
    expect(nativeCalls).toBe(4);
    expect(JSON.stringify(rawEvents)).not.toContain("sentinel");
    // The readable business UUIDs join back to the owning catalog without transmitting names.
    const catalog = new Map([
      [expectedPaths[0], "Первый продукт"],
      [expectedPaths[1], "Второй продукт"],
      [expectedPaths[2], "Первый материал"],
      [expectedPaths[3], "Второй материал"],
    ]);
    expect(rows.map((row) => catalog.get(row.urlPath)).sort()).toEqual(
      [
        "Первый материал",
        "Первый продукт",
        "Второй материал",
        "Второй продукт",
      ].sort(),
    );
    mark("native_events_verified");
    const known = new Set(rows.map((row) => row.id));
    const sessions: string[] = [];
    for (const [account, button] of [
      ["A", "Первый продукт"],
      ["B", "Второй продукт"],
      ["guest", "Открыть материал"],
    ]) {
      if (account === undefined || button === undefined)
        throw new Error("Account proof tuple required");
      requestScope.account = account;
      const accepted = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/analytics") &&
          response.request().method() === "POST",
      );
      await page.getByRole("button", { name: button, exact: true }).click();
      expect((await accepted).status()).toBe(200);
      let next: z.infer<typeof eventsSchema>["data"][number] | undefined;
      await browserExpect
        .poll(
          async () => {
            // deterministic-test-allow wall-clock: the pinned native Umami real-clock HTTP boundary owns these event timestamps.
            const now = Date.now();
            const response = await originalFetch(
              `http://127.0.0.1:13301/api/websites/${input.site}/events?startAt=${String(now - 60_000)}&endAt=${String(now)}&page=1&pageSize=100`,
              {
                headers: { authorization: `Bearer ${input.key}` },
                signal: AbortSignal.timeout(3000),
              },
            );
            if (!response.ok)
              throw new Error("Native identity reader refused the owned proof");
            rawEvents = await response.json();
            rows = eventsSchema.parse(rawEvents).data;
            next = rows.find((row) => !known.has(row.id));
            return next !== undefined;
          },
          { timeout: 10_000 },
        )
        .toBe(true);
      if (next === undefined)
        throw new Error("Native Account observation missing");
      known.add(next.id);
      sessions.push(next.sessionId);
    }
    expect(new Set(sessions).size).toBe(3);
    expect(nativeCalls).toBe(7);
    expect(JSON.stringify(rawEvents)).not.toContain(
      "20000000-0000-4000-8000-00000000000",
    );
    mark("identity_reset_verified");
    await page
      .getByRole("button", { name: "Настройки cookies и аналитики" })
      .click();
    await page
      .getByRole("button", { name: "Только необходимые", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Закрытый материал", exact: true })
      .click();
    await browserExpect(page.getByRole("status")).toHaveText(
      "access_restricted",
    );
    expect(nativeCalls).toBe(7);
    mark("revocation_verified");
  } finally {
    try {
      await browser?.close();
    } finally {
      await server.close();
    }
  }
});
