// deterministic-test-allow unit-io: native Telegram HTTP owned loopback; cleanup closes sockets and SDK, case budgets bound stuck requests.
import { createServer, type RequestListener } from "node:http";
import { once } from "node:events";
import { SpanKind, context } from "@opentelemetry/api";
import { z } from "zod";
import { technicalTelemetryFromEnvironment } from "../../src/infrastructure/observability/technical-telemetry-runtime.js";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import {
  AggregationTemporality,
  InMemoryMetricExporter,
} from "@opentelemetry/sdk-metrics";
import { expect, test, vi, type TestContext } from "vitest";
import { createTechnicalTelemetry } from "../../src/infrastructure/observability/technical-telemetry.js";
import { HttpTelegramLinkProvider } from "../../src/modules/telegram-membership/infrastructure/http/http-telegram-link-provider.js";
import { HttpTelegramContactsProvider } from "../../src/modules/telegram-membership/infrastructure/http/http-telegram-contacts-provider.js";
import { HttpTelegramSignInProvider } from "../../src/modules/telegram-membership/features/complete-telegram-sign-in/telegram-sign-in-provider.js";

async function listen(owner: TestContext, handler: RequestListener) {
  const server = createServer(handler);
  owner.onTestFinished(async () => {
    server.closeAllConnections();
    if (server.listening)
      await new Promise<void>((resolve, reject) =>
        server.close((error) =>
          error === undefined ? resolve() : reject(error),
        ),
      );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("owned listener unavailable");
  return `http://127.0.0.1:${address.port}`;
}
function runtime(owner: TestContext, enabled = true) {
  const spans = new InMemorySpanExporter();
  const metrics = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const telemetry = createTechnicalTelemetry({
    enabled,
    service: "platform-api",
    environment: "test",
    release: "proof",
    sampleRatio: 1,
    exporters: { spans, metrics },
  });
  owner.onTestFinished(() => telemetry.shutdown());
  return { telemetry, spans, metrics };
}
const registration = {
  accountRef: "private-account",
  expiresAt: new Date("2030-01-01T00:05:00Z"),
  returnCorrelation: "private-correlation",
  tokenDigest: "private-digest",
};
const registered = {
  contractVersion: "inside.identity-linking.v1",
  expiresAt: "2030-01-01T00:05:00Z",
  linkTransactionRef: "private-link",
  returnCorrelation: "private-correlation",
  status: "pending",
};

test("native registration preserves the request and records one validated completion", async (owner) => {
  let requests = 0;
  const endpoint = await listen(owner, (request, response) => {
    requests++;
    expect(request.method).toBe("POST");
    expect(request.headers.authorization).toBe("Bearer private-secret");
    expect(request.headers["traceparent"]).toBeUndefined();
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(registered));
  });
  const { telemetry, spans, metrics } = runtime(owner);
  const provider = new HttpTelegramLinkProvider(endpoint, "private-secret");
  await expect(
    telemetry.runJob(() => provider.register(registration)),
  ).resolves.toMatchObject({ kind: "registered" });
  await telemetry.flush();
  expect(requests).toBe(1);
  expect(spans.getFinishedSpans().map((span) => span.attributes)).toEqual([
    {
      "dependency.name": "telegram",
      "dependency.operation": "link.register",
      "http.request.method": "POST",
      "http.response.status_code": 200,
      "dependency.outcome": "completed",
    },
  ]);
  expect(
    JSON.stringify({
      spans: spans
        .getFinishedSpans()
        .map((span) => ({ attributes: span.attributes, events: span.events })),
      metrics: metrics.getMetrics(),
    }),
  ).not.toContain("private-");
}, 10_000);

test("non-ok responses remain unread and successful linking reads JSON exactly once", async (owner) => {
  const { telemetry, spans } = runtime(owner);
  const rejected = Response.json(
    { private: "private-unread" },
    { status: 503 },
  );
  const json = vi.spyOn(rejected, "json");
  const provider = new HttpTelegramLinkProvider(
    "http://private.invalid",
    "private-secret",
    () => Promise.resolve(rejected),
  );
  await expect(
    telemetry.runJob(() => provider.register(registration)),
  ).resolves.toEqual({ kind: "unavailable" });
  await expect(
    telemetry.runJob(() =>
      new HttpTelegramContactsProvider(
        "http://private.invalid",
        "private-secret",
        () => Promise.resolve(rejected),
      ).read([]),
    ),
  ).resolves.toEqual({ ok: false });
  expect(json).not.toHaveBeenCalled();
  const successful = Response.json(registered);
  const read = vi.spyOn(successful, "json");
  await telemetry.runJob(() =>
    new HttpTelegramLinkProvider(
      "http://private.invalid",
      "private-secret",
      () => Promise.resolve(successful),
    ).register(registration),
  );
  expect(read).toHaveBeenCalledTimes(1);
  await telemetry.flush();
  expect(spans.getFinishedSpans()).toHaveLength(3);
});

for (const status of [
  "conflict",
  "expired",
  "pending",
  "recovery-required",
  "replayed",
] as const) {
  test(`valid confirmation ${status} remains completed with the original result`, async (owner) => {
    const { telemetry, spans } = runtime(owner);
    const response = Response.json({ ...calls[1].valid, status });
    const result = await telemetry.runJob(() =>
      new HttpTelegramLinkProvider(
        "http://private.invalid",
        "private-secret",
        () => Promise.resolve(response),
      ).confirm({
        accountRef: "private-account",
        linkTransactionRef: "private-link",
        returnCorrelation: "private-correlation",
      }),
    );
    expect(result).toEqual({
      kind: status === "recovery-required" ? "recovery_required" : status,
    });
    await telemetry.flush();
    expect(spans.getFinishedSpans()[0]?.attributes["dependency.outcome"]).toBe(
      "completed",
    );
  });
}

for (const exporterStatus of [200, 503]) {
  test(`native OTLP ${exporterStatus} preserves all four business calls and exports no private values`, async (owner) => {
    const exported: string[] = [];
    const collector = await listen(owner, (request, response) => {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk: string) => {
        body += chunk;
        if (body.length > 1_048_576) request.destroy();
      });
      request.on("end", () => {
        exported.push(body);
        response
          .writeHead(exporterStatus, { "content-type": "application/json" })
          .end("{}");
      });
    });
    for (const key of Object.keys(process.env))
      if (key.startsWith("OTEL_EXPORTER_OTLP")) vi.stubEnv(key, undefined);
    owner.onTestFinished(() => {
      vi.unstubAllEnvs();
    });
    const telemetry = technicalTelemetryFromEnvironment({
      environment: {
        INSIDE_OTEL_ENABLED: "true",
        INSIDE_OTEL_ENDPOINT: collector,
      },
      service: "platform-api",
      mode: "test",
      identity: { release: "a".repeat(40), sourceSha: "a".repeat(40) },
    });
    owner.onTestFinished(() => telemetry.shutdown());
    let requests = 0;
    const endpoint = await listen(owner, (request, response) => {
      requests++;
      request.resume();
      response.end(
        JSON.stringify(
          request.url === "/telegram-contacts"
            ? calls[2].valid
            : request.url?.includes("account-link") === true
              ? calls[3].valid
              : request.url?.includes("confirm") === true
                ? calls[1].valid
                : registered,
        ),
      );
    });
    for (const call of calls)
      await telemetry.runJob<unknown>(() => call.invoke(endpoint));
    await telemetry.flush();
    expect(requests).toBe(4);
    expect(exported.length).toBeGreaterThan(0);
    const schema = z.object({
      resourceSpans: z.array(
        z.object({
          scopeSpans: z.array(
            z.object({
              spans: z.array(
                z.object({
                  spanId: z.string(),
                  name: z.string(),
                  attributes: z.array(
                    z.object({ key: z.string(), value: z.unknown() }),
                  ),
                }),
              ),
            }),
          ),
        }),
      ),
    });
    const spans = exported.flatMap((body) => {
      const parsed = schema.safeParse(JSON.parse(body));
      return parsed.success
        ? parsed.data.resourceSpans.flatMap((resource) =>
            resource.scopeSpans.flatMap((scope) => scope.spans),
          )
        : [];
    });
    expect(
      [
        ...new Map(spans.map((span) => [span.spanId, span.name])).values(),
      ].sort(),
    ).toEqual([
      "telegram contacts.read",
      "telegram link.confirm",
      "telegram link.register",
      "telegram signin.bindAccount",
    ]);
    for (const span of spans)
      expect(span.attributes.map((attribute) => attribute.key).sort()).toEqual([
        "dependency.name",
        "dependency.operation",
        "dependency.outcome",
        "http.request.method",
        "http.response.status_code",
      ]);
    expect(exported.join("\n")).not.toContain("private-");
    expect(exported.join("\n")).not.toContain(endpoint);
  }, 15_000);
}

test("default-follow linking counts one invocation while the two redirect-error adapters never follow", async (owner) => {
  let targetRequests = 0;
  const target = await listen(owner, (request, response) => {
    targetRequests++;
    expect(request.method).toBe("POST");
    request.resume();
    response.end(JSON.stringify(registered));
  });
  let redirects = 0;
  const endpoint = await listen(owner, (request, response) => {
    redirects++;
    request.resume();
    response.writeHead(307, { location: target }).end();
  });
  const { telemetry, spans } = runtime(owner);
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  owner.onTestFinished(() => log.mockRestore());
  await expect(
    telemetry.runJob(() => calls[0].invoke(endpoint)),
  ).resolves.toMatchObject({ kind: "registered" });
  await expect(
    telemetry.runJob(() => calls[2].invoke(endpoint)),
  ).resolves.toEqual({ ok: false });
  await expect(
    telemetry.runJob(() => calls[3].invoke(endpoint)),
  ).resolves.toEqual({ status: "unavailable" });
  await telemetry.flush();
  expect(redirects).toBe(3);
  expect(targetRequests).toBe(1);
  expect(
    spans
      .getFinishedSpans()
      .map((span) => span.attributes["dependency.outcome"]),
  ).toEqual(["completed", "failed", "failed"]);
}, 10_000);

test("native five-second aborts preserve all four unavailable outcomes without retries", async (owner) => {
  let requests = 0;
  const endpoint = await listen(owner, (request, response) => {
    requests++;
    request.resume();
    response.writeHead(200);
    response.flushHeaders();
  });
  const { telemetry, spans } = runtime(owner);
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  owner.onTestFinished(() => log.mockRestore());
  await Promise.all(
    calls.map(async (call) => {
      await expect(
        telemetry.runJob<unknown>(() => call.invoke(endpoint)),
      ).resolves.toEqual(call.unavailable);
    }),
  );
  await telemetry.flush();
  expect(requests).toBe(4);
  expect(
    spans
      .getFinishedSpans()
      .map((span) => span.attributes["dependency.outcome"]),
  ).toEqual(["failed", "failed", "failed", "failed"]);
}, 15_000);

test("no-secret and prefetch serialization or URL refusals create no observation", async (owner) => {
  const { telemetry, spans, metrics } = runtime(owner);
  const fetcher = vi.fn<typeof fetch>();
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  owner.onTestFinished(() => log.mockRestore());
  await telemetry.runJob(async () => {
    expect(
      await new HttpTelegramContactsProvider(
        "invalid",
        undefined,
        fetcher,
      ).read([]),
    ).toEqual({ ok: false });
    expect(
      await new HttpTelegramSignInProvider("invalid", undefined).bindAccount(
        "a",
        "b",
        "c",
      ),
    ).toEqual({ status: "unavailable" });
    expect(
      await new HttpTelegramContactsProvider(
        "invalid",
        "private-secret",
        fetcher,
      ).read([]),
    ).toEqual({ ok: false });
    await expect(
      new HttpTelegramLinkProvider(
        "invalid",
        "private-secret",
        fetcher,
      ).register({ ...registration, expiresAt: new Date(NaN) }),
    ).rejects.toThrow(RangeError);
  });
  await telemetry.flush();
  expect(fetcher).not.toHaveBeenCalled();
  expect(spans.getFinishedSpans()).toHaveLength(0);
  expect(
    metrics
      .getMetrics()
      .flatMap((resource) =>
        resource.scopeMetrics.flatMap((scope) => scope.metrics),
      )
      .find(
        (metric) => metric.descriptor.name === "inside.dependency.operations",
      )?.dataPoints ?? [],
  ).toEqual([]);
});

test("concurrent native bodies retain distinct parents and OFF masks the enabled parent", async (owner) => {
  const responses: (() => void)[] = [];
  let both!: () => void;
  const admitted = new Promise<void>((resolve) => {
    both = resolve;
  });
  const endpoint = await listen(owner, (request, response) => {
    request.resume();
    response.writeHead(200, { "content-type": "application/json" });
    response.flushHeaders();
    responses.push(() => response.end(JSON.stringify(registered)));
    if (responses.length === 2) both();
  });
  const { telemetry, spans } = runtime(owner);
  const disabled = runtime(owner, false).telemetry;
  const first = telemetry.startHttp({ method: "POST", route: "/first" });
  const second = telemetry.startHttp({ method: "POST", route: "/second" });
  owner.onTestFinished(() => {
    responses.forEach((end) => end());
    first.finish(200, 1);
    second.finish(200, 1);
  });
  const one = first.run(() => calls[0].invoke(endpoint));
  const two = second.run(() => calls[0].invoke(endpoint));
  await admitted;
  await telemetry.flush();
  expect(spans.getFinishedSpans()).toHaveLength(0);
  responses[1]?.();
  await two;
  second.finish(200, 1);
  responses[0]?.();
  await one;
  first.finish(200, 1);
  const offlineEndpoint = await listen(owner, (request, response) => {
    request.resume();
    response.end(JSON.stringify(registered));
  });
  await telemetry.runJob(async () => {
    const before = context.active();
    await disabled.runJob(() => calls[0].invoke(offlineEndpoint));
    expect(context.active()).toBe(before);
  });
  await telemetry.flush();
  const finished = spans.getFinishedSpans();
  expect(
    finished
      .filter((span) => span.kind === SpanKind.CLIENT)
      .map((span) => span.parentSpanContext?.spanId)
      .sort(),
  ).toEqual(
    finished
      .filter((span) => span.kind === SpanKind.SERVER)
      .map((span) => span.spanContext().spanId)
      .sort(),
  );
  expect(finished.filter((span) => span.kind === SpanKind.CLIENT)).toHaveLength(
    2,
  );
}, 10_000);

const calls = [
  {
    operation: "link.register",
    invoke: (endpoint: string) =>
      new HttpTelegramLinkProvider(endpoint, "private-secret").register(
        registration,
      ),
    valid: registered,
    unavailable: { kind: "unavailable" },
    malformed: { kind: "recovery_required" },
  },
  {
    operation: "link.confirm",
    invoke: (endpoint: string) =>
      new HttpTelegramLinkProvider(endpoint, "private-secret").confirm({
        accountRef: "private-account",
        linkTransactionRef: "private-link",
        returnCorrelation: "private-correlation",
      }),
    valid: {
      contractVersion: "inside.identity-linking.v1",
      linkTransactionRef: "private-link",
      returnCorrelation: "private-correlation",
      status: "recovery-required",
    },
    unavailable: { kind: "unavailable" },
    malformed: { kind: "recovery_required" },
  },
  {
    operation: "contacts.read",
    invoke: (endpoint: string) =>
      new HttpTelegramContactsProvider(endpoint, "private-secret").read([
        {
          accountRef: "private-account",
          telegramIdentityRef: "private-identity",
        },
      ]),
    valid: { contractVersion: "inside.telegram-contact.v1", contacts: [] },
    unavailable: { ok: false },
    malformed: { ok: false },
  },
  {
    operation: "signin.bindAccount",
    invoke: (endpoint: string) =>
      new HttpTelegramSignInProvider(endpoint, "private-secret").bindAccount(
        "private-request",
        "private-subject",
        "private-account",
      ),
    valid: {
      contractVersion: "inside.bot-sign-in.v1",
      status: "linked",
      telegramIdentityRef: "11111111-1111-4111-8111-111111111111",
    },
    unavailable: { status: "unavailable" },
    malformed: { status: "unavailable" },
  },
] as const;

for (const call of calls) {
  for (const mode of [
    "valid",
    "http",
    "json",
    "shape",
    "disconnect",
  ] as const) {
    test(`${call.operation} native ${mode} keeps business mapping and one closed completion`, async (owner) => {
      const log = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
      owner.onTestFinished(() => log.mockRestore());
      let requests = 0;
      const endpoint = await listen(owner, (request, response) => {
        requests++;
        expect(request.headers["traceparent"]).toBeUndefined();
        expect(request.headers["tracestate"]).toBeUndefined();
        request.resume();
        if (mode === "disconnect") {
          request.socket.destroy();
          return;
        }
        response.setHeader("content-type", "application/json");
        if (mode === "http") response.writeHead(503).end("private-unread");
        else if (mode === "json") response.end("private-invalid-json");
        else
          response.end(
            JSON.stringify(
              mode === "shape" ? { private: "private-body" } : call.valid,
            ),
          );
      });
      const { telemetry, spans, metrics } = runtime(owner);
      const result = await telemetry.runJob(() => call.invoke(endpoint));
      if (mode !== "valid")
        expect(result).toEqual(
          mode === "shape" ? call.malformed : call.unavailable,
        );
      await telemetry.flush();
      expect(requests).toBe(1);
      const finished = spans.getFinishedSpans();
      expect(finished).toHaveLength(1);
      expect(finished[0]?.attributes).toMatchObject({
        "dependency.operation": call.operation,
        "dependency.outcome": mode === "valid" ? "completed" : "failed",
      });
      const data = metrics
        .getMetrics()
        .flatMap((resource) =>
          resource.scopeMetrics.flatMap((scope) => scope.metrics),
        );
      expect(
        data.find(
          (metric) => metric.descriptor.name === "inside.dependency.operations",
        )?.dataPoints,
      ).toMatchObject([
        {
          attributes: {
            dependency: "telegram",
            operation: call.operation,
            outcome: mode === "valid" ? "completed" : "failed",
          },
          value: 1,
        },
      ]);
      expect(
        data.find(
          (metric) => metric.descriptor.name === "inside.dependency.duration",
        )?.dataPoints,
      ).toHaveLength(1);
      expect(
        JSON.stringify({
          spans: finished.map((span) => ({
            attributes: span.attributes,
            events: span.events,
            status: span.status,
          })),
          metrics: metrics.getMetrics(),
        }),
      ).not.toContain("private-");
    }, 10_000);
  }
}

test("contacts and sign-in preserve optional fallback and permissive conflict as different technical outcomes", async (owner) => {
  let requests = 0;
  const endpoint = await listen(owner, (request, response) => {
    requests++;
    expect(request.headers["traceparent"]).toBeUndefined();
    if (request.url === "/telegram-contacts")
      response.writeHead(404).end("private-unread-body");
    else
      response.end(
        JSON.stringify({
          status: "conflict",
          extra: "private-compatibility-field",
        }),
      );
  });
  const { telemetry, spans } = runtime(owner);
  await expect(
    telemetry.runJob(() =>
      new HttpTelegramContactsProvider(endpoint, "private-secret").read([]),
    ),
  ).resolves.toEqual({ ok: false });
  await expect(
    telemetry.runJob(() =>
      new HttpTelegramSignInProvider(endpoint, "private-secret").bindAccount(
        "private-request",
        "private-subject",
        "private-account",
      ),
    ),
  ).resolves.toEqual({ status: "conflict" });
  await telemetry.flush();
  expect(requests).toBe(2);
  expect(
    spans
      .getFinishedSpans()
      .map((span) => [
        span.attributes["dependency.operation"],
        span.attributes["dependency.outcome"],
      ]),
  ).toEqual([
    ["contacts.read", "failed"],
    ["signin.bindAccount", "completed"],
  ]);
}, 10_000);
