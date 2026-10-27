import { once } from "node:events";
import { channel } from "node:diagnostics_channel";
import { createServer, type Server } from "node:http";
import { expect, it, vi } from "vitest";

import {
  startWebHttpMetrics,
  webHttpRoutes,
} from "../../runtime/web-http-metrics";

it("uses the exact Next build regex without changing its supported escape semantics", () => {
  const routes = webHttpRoutes({
    staticRoutes: [
      { page: "/_global-error", regex: "^/_global\\-error(?:/)?$" },
    ],
    dynamicRoutes: [],
  });
  expect(routes[0]?.pattern.test("/_global-error")).toBe(true);
});

// owned Node HTTP diagnostics boundary, loopback only, closed in finally.
it("counts the real completed Web response without exporting its private URL", async () => {
  const app = createServer((_request, response) => response.end("ready"));
  await withListeningApplication(app, async (address) => {
    const metrics = await startWebHttpMetrics({
      applicationPort: address.port,
      host: "127.0.0.1",
      port: 0,
      routes: webHttpRoutes({
        staticRoutes: [],
        dynamicRoutes: [
          { page: "/products/[slug]", regex: "^/products/[^/]+$" },
        ],
      }),
      sourceSha: "7".repeat(40),
      environment: "test",
    });
    try {
      const result = await fetch(
        `http://127.0.0.1:${String(address.port)}/products/private-sentinel?email=secret@example.test`,
      );
      expect(await result.text()).toBe("ready");
      const second = await fetch(
        `http://127.0.0.1:${String(address.port)}/products/second-private?email=another@example.test`,
      );
      expect(await second.text()).toBe("ready");
      const raw = await (
        await fetch(`http://127.0.0.1:${String(metrics.port)}/metrics`)
      ).text();
      expect(
        raw
          .split("\n")
          .filter((row) => row !== "" && !row.startsWith("#"))
          .every((row) => row.includes(`source_sha="${"7".repeat(40)}"`)),
      ).toBe(true);
      const wire = raw
        .replaceAll(`,source_sha="${"7".repeat(40)}"`, "")
        .replaceAll(',environment="test"', "");
      expect(wire).toContain(
        'inside_web_http_requests_total{service="platform-web",route="/products/[slug]",method="GET",code="200",outcome="completed"} 2',
      );
      expect(wire).not.toMatch(
        /private-sentinel|secret@example|email=|second-private|another@example/u,
      );
    } finally {
      await metrics.stop();
    }
  });
});

// real Node publisher schema refusal and private HTTP source, closed in finally.
it("makes an unsupported Node publisher format unavailable without exporting its body", async () => {
  const metrics = await startWebHttpMetrics({
    applicationPort: 1,
    host: "127.0.0.1",
    port: 0,
    routes: [],
    sourceSha: "7".repeat(40),
    environment: "test",
  });
  try {
    channel("http.server.request.start").publish({
      request: "private-publisher-sentinel",
    });
    const response = await fetch(
      `http://127.0.0.1:${String(metrics.port)}/metrics`,
    );
    expect(response.status).toBe(503);
    expect(await response.text()).toBe("");
  } finally {
    await metrics.stop();
  }
});

async function withListeningApplication(
  app: Server,
  run: (address: { port: number }) => Promise<void>,
): Promise<void> {
  try {
    app.listen(0, "127.0.0.1");
    await once(app, "listening");
    const address = app.address();
    if (address === null || typeof address === "string")
      throw new Error("test_address");
    await run(address);
  } finally {
    if (app.listening) await close(app);
  }
}

it("closes the listening application when metrics startup rejects its source identity", async () => {
  const app = createServer((_request, response) => response.end("owned"));
  let failedPort: number | undefined;
  try {
    await expect(
      withListeningApplication(app, async (address) => {
        failedPort = address.port;
        await startWebHttpMetrics({
          applicationPort: address.port,
          host: "127.0.0.1",
          port: 0,
          routes: [],
          sourceSha: "invalid-source",
          environment: "test",
        });
      }),
    ).rejects.toThrow();
    expect(app.listening).toBe(false);
    expect(app.address()).toBe(null);
    if (failedPort === undefined) throw new Error("application_did_not_listen");
    await expect(
      fetch(`http://127.0.0.1:${String(failedPort)}/`, {
        signal: AbortSignal.timeout(1000),
      }),
    ).rejects.toThrow();
  } finally {
    // The negative contract must also clean up when the lifetime owner regresses.
    if (app.listening) await close(app);
  }
});

async function close(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => {
      if (error === undefined) resolve();
      else reject(error);
    }),
  );
}

// actual Node HTTP finish/close and owned loopback cleanup, no live provider.
it("keeps 404, 500 and interrupted streams distinct, balances active requests and ignores trace sampling", async () => {
  let closed: (() => void) | undefined;
  const streamClosed = new Promise<void>((resolve) => {
    closed = resolve;
  });
  const app = createServer((request, response) => {
    if (request.url?.startsWith("/stream") === true) {
      response.writeHead(200, { "Content-Type": "text/plain" });
      response.write("held");
      response.once("close", () => closed?.());
      return;
    }
    response.writeHead(request.url === "/failure" ? 500 : 404).end("synthetic");
  });
  await withListeningApplication(app, async (address) => {
    const metrics = await startWebHttpMetrics({
      applicationPort: address.port,
      host: "127.0.0.1",
      port: 0,
      routes: webHttpRoutes({
        staticRoutes: [
          { page: "/failure", regex: "^/failure$" },
          { page: "/stream", regex: "^/stream$" },
        ],
        dynamicRoutes: [],
      }),
      sourceSha: "7".repeat(40),
      environment: "test",
    });
    const read = async (): Promise<string> =>
      (
        await (
          await fetch(`http://127.0.0.1:${String(metrics.port)}/metrics`)
        ).text()
      )
        .replaceAll(`,source_sha="${"7".repeat(40)}"`, "")
        .replaceAll(',environment="test"', "");
    try {
      vi.stubEnv("INSIDE_OTEL_SAMPLE_RATIO", "0");
      const failure = await fetch(
        `http://127.0.0.1:${String(address.port)}/failure`,
      );
      expect(failure.status).toBe(500);
      await failure.text();
      const missing = await fetch(
        `http://127.0.0.1:${String(address.port)}/missing-private?token=secret`,
      );
      expect(missing.status).toBe(404);
      await missing.text();
      const stream = await fetch(
        `http://127.0.0.1:${String(address.port)}/stream`,
      );
      const during = await read();
      expect(during).toContain(
        'inside_web_http_active_requests{service="platform-web",route="/stream",method="GET"} 1',
      );
      expect(during).not.toContain(
        'route="/stream",method="GET",code="200",outcome="completed"',
      );
      await stream.body?.cancel();
      await streamClosed;
      const wire = await read();
      expect(wire).toContain(
        'inside_web_http_requests_total{service="platform-web",route="/failure",method="GET",code="500",outcome="completed"} 1',
      );
      expect(wire).toContain(
        'inside_web_http_requests_total{service="platform-web",route="_unmatched",method="GET",code="404",outcome="completed"} 1',
      );
      expect(wire).toContain(
        'inside_web_http_requests_total{service="platform-web",route="/stream",method="GET",code="200",outcome="aborted"} 1',
      );
      expect(wire).toContain(
        'inside_web_http_active_requests{service="platform-web",route="/stream",method="GET"} 0',
      );
      expect(wire).toContain(
        'inside_web_http_source_info{service="platform-web"} 1',
      );
      expect(wire).not.toMatch(/missing-private|token=|secret/u);
      expect(
        (await read()).replace(
          /inside_web_http_observed_at_seconds[^\n]+/u,
          "",
        ),
      ).toBe(wire.replace(/inside_web_http_observed_at_seconds[^\n]+/u, ""));
    } finally {
      vi.unstubAllEnvs();
      await metrics.stop();
    }
  });
});
