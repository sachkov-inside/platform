// deterministic-test-allow unit-io: owned JWKS HTTP loopback contract; cleanup closes native sockets and the SDK.
import { createServer, type RequestListener } from "node:http";
import { once } from "node:events";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
  context,
  createContextKey,
  ROOT_CONTEXT,
  SpanKind,
} from "@opentelemetry/api";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import {
  AggregationTemporality,
  InMemoryMetricExporter,
} from "@opentelemetry/sdk-metrics";
import { z } from "zod";
import { technicalTelemetryFromEnvironment } from "../../src/infrastructure/observability/technical-telemetry-runtime.js";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { expect, test, vi, type TestContext } from "vitest";
import {
  fixedTestInstant,
  registerFixedClock,
} from "../support/fixed-clock.js";
import {
  createTechnicalTelemetry,
  observeLogtoJwksRequest,
} from "../../src/infrastructure/observability/technical-telemetry.js";
import { createLogtoAccessTokenVerifier } from "../../src/modules/accounts/infrastructure/idp/logto/logto-access-token-verifier.js";

registerFixedClock();
const issuer = "https://private-issuer.example.test/oidc";
const audience = "https://private-audience.example.test";
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
    throw new Error("owned JWKS listener unavailable");
  return `http://127.0.0.1:${address.port}/private-jwks`;
}
async function identity() {
  const pair = await generateKeyPair("ES384");
  const jwk = {
    ...(await exportJWK(pair.publicKey)),
    kid: "private-key-id",
    alg: "ES384",
  };
  return {
    jwk,
    sign(kid = jwk.kid) {
      // deterministic-test-allow wall-clock: registerFixedClock owns the Date shared by JOSE and these signed fixtures.
      const now = Math.floor(Date.now() / 1_000);
      return new SignJWT({
        inside_verified_email: "private-email@example.test",
        scope: "private-scope",
      })
        .setProtectedHeader({ alg: "ES384", kid })
        .setIssuer(issuer)
        .setAudience(audience)
        .setSubject("private-subject")
        .setIssuedAt(now)
        .setExpirationTime(now + 300)
        .sign(pair.privateKey);
    },
  };
}
function runtime(owner: TestContext, sampleRatio = 1) {
  const spans = new InMemorySpanExporter();
  const metrics = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const telemetry = createTechnicalTelemetry({
    enabled: true,
    service: "platform-api",
    environment: "test",
    release: "proof",
    sampleRatio,
    exporters: { spans, metrics },
  });
  owner.onTestFinished(() => telemetry.shutdown());
  return { spans, metrics, telemetry };
}

test("a cold remote JWKS fetch emits one safe GET completion and cached verifications add no requests", async (owner) => {
  const keys = await identity();
  let calls = 0;
  const jwksUrl = await listen(owner, (request, response) => {
    calls++;
    expect(request.method).toBe("GET");
    expect(request.headers["traceparent"]).toBeUndefined();
    expect(request.headers["tracestate"]).toBeUndefined();
    expect(request.headers["baggage"]).toBeUndefined();
    request.resume();
    response
      .writeHead(200, { "content-type": "application/json" })
      .end(JSON.stringify({ keys: [keys.jwk] }));
  });
  const { spans, metrics, telemetry } = runtime(owner);
  const verifier = createLogtoAccessTokenVerifier({
    issuer,
    audience,
    jwksUrl,
  });
  const token = await keys.sign();
  await telemetry.runJob(async () => {
    expect(await verifier.verifyAccount(token)).toMatchObject({ ok: true });
    expect(await verifier.verifyAccount(token)).toMatchObject({ ok: true });
  });
  await telemetry.flush();
  expect(calls).toBe(1);
  const clients = spans
    .getFinishedSpans()
    .filter((span) => span.kind === SpanKind.CLIENT);
  expect(clients).toHaveLength(1);
  expect(clients[0]?.attributes).toEqual({
    "dependency.name": "logto",
    "dependency.operation": "jwks",
    "dependency.outcome": "completed",
    "http.request.method": "GET",
    "http.response.status_code": 200,
  });
  const count = metrics
    .getMetrics()
    .flatMap((resource) =>
      resource.scopeMetrics.flatMap((scope) => scope.metrics),
    )
    .find(
      (metric) => metric.descriptor.name === "inside.dependency.operations",
    );
  expect(count?.dataPoints).toMatchObject([
    {
      attributes: {
        dependency: "logto",
        operation: "jwks",
        outcome: "completed",
      },
      value: 1,
    },
  ]);
  expect(
    JSON.stringify({
      spans: clients.map((span) => ({
        name: span.name,
        attributes: span.attributes,
        events: span.events,
        status: span.status,
      })),
      metrics: metrics.getMetrics(),
    }),
  ).not.toContain("private-");
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

test("concurrent verifications share one fetch whose span ends at headers before JOSE consumes its body", async (owner) => {
  const keys = await identity();
  const release = deferred();
  owner.onTestFinished(() => release.resolve());
  let calls = 0;
  const jwksUrl = await listen(owner, (request, response) => {
    calls++;
    request.resume();
    response.writeHead(200, { "content-type": "application/json" });
    response.flushHeaders();
    void release.promise.then(() =>
      response.end(JSON.stringify({ keys: [keys.jwk] })),
    );
  });
  const { telemetry, spans } = runtime(owner);
  const verifier = createLogtoAccessTokenVerifier({
    issuer,
    audience,
    jwksUrl,
  });
  const token = await keys.sign();
  const first = telemetry.startHttp({ method: "GET", route: "/accounts/me" });
  const second = telemetry.startHttp({ method: "GET", route: "/mcp" });
  const parent = first.run(() => telemetry.correlation()["spanId"]);
  let settled = 0;
  const pending = first.run(async () => {
    const result = await verifier.verifyAccount(token);
    settled++;
    expect(telemetry.correlation()["spanId"]).toBe(parent);
    return result;
  });
  const waiters = Array.from({ length: 8 }, () =>
    second.run(() => verifier.verifyAccount(token)),
  );
  owner.onTestFinished(async () => {
    release.resolve();
    await Promise.allSettled([pending, ...waiters]);
  });
  await vi.waitFor(async () => {
    await telemetry.flush();
    expect(
      spans.getFinishedSpans().filter((span) => span.kind === SpanKind.CLIENT),
    ).toHaveLength(1);
  });
  expect(settled).toBe(0);
  expect(calls).toBe(1);
  expect(spans.getFinishedSpans()[0]?.parentSpanContext?.spanId).toBe(parent);
  release.resolve();
  expect(
    (await Promise.all([pending, ...waiters])).every((value) => value.ok),
  ).toBe(true);
  first.finish(200, 1);
  second.finish(200, 1);
  await telemetry.flush();
  expect(
    spans.getFinishedSpans().filter((span) => span.kind === SpanKind.CLIENT),
  ).toHaveLength(1);
  expect(telemetry.correlation()).toEqual({});
});

test("missing-key cooldown and ten-minute cache expiry preserve the native reload request counts", async (owner) => {
  const keys = await identity();
  let calls = 0;
  let kid = keys.jwk.kid;
  const jwksUrl = await listen(owner, (request, response) => {
    calls++;
    request.resume();
    response
      .writeHead(200, { "content-type": "application/json" })
      .end(JSON.stringify({ keys: [{ ...keys.jwk, kid }] }));
  });
  const { telemetry, spans } = runtime(owner);
  const verifier = createLogtoAccessTokenVerifier({
    issuer,
    audience,
    jwksUrl,
  });
  await telemetry.runJob(async () => {
    expect(await verifier.verifyAccount(await keys.sign())).toMatchObject({
      ok: true,
    });
    kid = "private-rotated-key";
    expect(await verifier.verifyAccount(await keys.sign(kid))).toMatchObject({
      ok: false,
      error: { code: "invalid_proof" },
    });
    expect(calls).toBe(1);
    vi.setSystemTime(fixedTestInstant() + 30_001);
    expect(await verifier.verifyAccount(await keys.sign(kid))).toMatchObject({
      ok: true,
    });
    expect(calls).toBe(2);
    vi.setSystemTime(fixedTestInstant() + 630_002);
    expect(await verifier.verifyAccount(await keys.sign(kid))).toMatchObject({
      ok: true,
    });
    expect(calls).toBe(3);
  });
  await telemetry.flush();
  expect(spans.getFinishedSpans()).toHaveLength(3);
});

test("HTTP failures and later malformed/truncated JWKS preserve authentication mapping and recovery", async (owner) => {
  const keys = await identity();
  let calls = 0;
  let mode = "success";
  let truncate: (() => void) | undefined;
  const pending: Promise<void>[] = [];
  owner.onTestFinished(async () => {
    truncate?.();
    await Promise.allSettled(pending);
  });
  const jwksUrl = await listen(owner, (request, response) => {
    calls++;
    request.resume();
    if (mode === "cancel") {
      request.socket.destroy();
      return;
    }
    if (mode === "503") {
      response.writeHead(503).end("private-provider-error");
      return;
    }
    response.setHeader("content-type", "application/json");
    if (mode === "malformed") {
      response.end("{");
      return;
    }
    if (mode === "truncated") {
      response.writeHead(200, { "content-length": "1000" });
      response.flushHeaders();
      response.write('{"keys":');
      truncate = () => {
        response.destroy();
      };
      return;
    }
    if (mode === "invalid-keys") {
      response.end('{"keys":"private-invalid"}');
      return;
    }
    response.end(JSON.stringify({ keys: [keys.jwk] }));
  });
  const { telemetry, spans } = runtime(owner);
  const token = await keys.sign();
  for (const fault of [
    "503",
    "malformed",
    "truncated",
    "invalid-keys",
    "cancel",
  ]) {
    const verifier = createLogtoAccessTokenVerifier({
      issuer,
      audience,
      jwksUrl,
    });
    mode = fault;
    const before = calls;
    const verifying = telemetry.runJob(async () => {
      expect(await verifier.verifyAccount(token)).toEqual({
        ok: false,
        error: {
          code:
            fault === "invalid-keys"
              ? "invalid_proof"
              : "dependency_unavailable",
        },
      });
    });
    pending.push(verifying);
    if (fault === "truncated") {
      await vi.waitFor(async () => {
        await telemetry.flush();
        expect(spans.getFinishedSpans()).toHaveLength(before + 1);
      });
      truncate?.();
    }
    await verifying;
    mode = "success";
    await telemetry.runJob(async () => {
      expect(await verifier.verifyAccount(token)).toMatchObject({ ok: true });
    });
  }
  await telemetry.flush();
  expect(calls).toBe(10);
  expect(
    spans
      .getFinishedSpans()
      .map((span) => span.attributes["dependency.outcome"]),
  ).toEqual([
    "failed",
    "completed",
    "completed",
    "completed",
    "completed",
    "completed",
    "completed",
    "completed",
    "failed",
    "completed",
  ]);
  expect(
    JSON.stringify(
      spans.getFinishedSpans().map((span) => ({
        attributes: span.attributes,
        events: span.events,
        status: span.status,
      })),
    ),
  ).not.toContain("private-");
});

test("remote native two-second timeout and manual redirects do not retry or change auth failure", async (owner) => {
  let calls = 0;
  let redirectCalls = 0;
  const target = await listen(owner, (request, response) => {
    redirectCalls++;
    request.resume();
    response.end("{}");
  });
  let redirect = false;
  const jwksUrl = await listen(owner, (request, response) => {
    calls++;
    request.resume();
    if (redirect) response.writeHead(302, { location: target }).end();
  });
  const { telemetry, spans } = runtime(owner);
  const keys = await identity();
  const token = await keys.sign();
  await telemetry.runJob(async () => {
    expect(
      await createLogtoAccessTokenVerifier({
        issuer,
        audience,
        jwksUrl,
      }).verifyAccount(token),
    ).toEqual({ ok: false, error: { code: "dependency_unavailable" } });
    redirect = true;
    expect(
      await createLogtoAccessTokenVerifier({
        issuer,
        audience,
        jwksUrl,
      }).verifyAccount(token),
    ).toEqual({ ok: false, error: { code: "dependency_unavailable" } });
  });
  await telemetry.flush();
  expect(calls).toBe(2);
  expect(redirectCalls).toBe(0);
  expect(
    spans
      .getFinishedSpans()
      .map((span) => [
        span.attributes["http.response.status_code"],
        span.attributes["dependency.outcome"],
      ]),
  ).toEqual([
    [undefined, "failed"],
    [302, "failed"],
  ]);
});

test("local keys and nested OFF add no telemetry; zero trace sampling still counts the one remote fetch", async (owner) => {
  const keys = await identity();
  let calls = 0;
  const jwksUrl = await listen(owner, (request, response) => {
    calls++;
    request.resume();
    response.end(JSON.stringify({ keys: [keys.jwk] }));
  });
  const { telemetry, metrics, spans } = runtime(owner, 0);
  const off = createTechnicalTelemetry({ enabled: false });
  owner.onTestFinished(() => off.shutdown());
  const token = await keys.sign();
  const local = createLogtoAccessTokenVerifier({
    issuer,
    audience,
    jwks: { keys: [keys.jwk] },
  });
  await telemetry.runJob(() => local.verifyAccount(token));
  expect(calls).toBe(0);
  await telemetry.runJob(() =>
    off.runJob(() =>
      createLogtoAccessTokenVerifier({
        issuer,
        audience,
        jwksUrl,
      }).verifyAccount(token),
    ),
  );
  await telemetry.flush();
  expect(
    metrics
      .getMetrics()
      .flatMap((resource) =>
        resource.scopeMetrics.flatMap((scope) => scope.metrics),
      )
      .some(
        (metric) => metric.descriptor.name === "inside.dependency.operations",
      ),
  ).toBe(false);
  await telemetry.runJob(() =>
    createLogtoAccessTokenVerifier({ issuer, audience, jwksUrl }).verifyAccount(
      token,
    ),
  );
  await telemetry.flush();
  expect(calls).toBe(2);
  expect(spans.getFinishedSpans()).toEqual([]);
  expect(
    metrics
      .getMetrics()
      .flatMap((resource) =>
        resource.scopeMetrics.flatMap((scope) => scope.metrics),
      )
      .find(
        (metric) => metric.descriptor.name === "inside.dependency.operations",
      )?.dataPoints,
  ).toMatchObject([
    {
      attributes: {
        dependency: "logto",
        operation: "jwks",
        outcome: "completed",
      },
      value: 1,
    },
  ]);
});

for (const exportStatus of [200, 503] as const) {
  test(`native JWKS request survives OTLP HTTP ${exportStatus} and exports no provider identity`, async (owner) => {
    const keys = await identity();
    let calls = 0;
    const exported: string[] = [];
    const exporterUrl = await listen(owner, (request, response) => {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk: string) => {
        body += chunk;
        if (body.length > 1_048_576) request.destroy();
      });
      request.on("end", () => {
        exported.push(body);
        response
          .writeHead(exportStatus, { "content-type": "application/json" })
          .end(exportStatus === 200 ? "{}" : "private-export-error");
      });
    });
    const jwksUrl = await listen(owner, (request, response) => {
      calls++;
      request.resume();
      response.end(JSON.stringify({ keys: [keys.jwk] }));
    });
    for (const key of Object.keys(process.env))
      if (key.startsWith("OTEL_EXPORTER_OTLP")) vi.stubEnv(key, undefined);
    owner.onTestFinished(() => {
      vi.unstubAllEnvs();
    });
    const warnings = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    owner.onTestFinished(() => {
      warnings.mockRestore();
    });
    const telemetry = technicalTelemetryFromEnvironment({
      environment: {
        INSIDE_OTEL_ENABLED: "true",
        INSIDE_OTEL_ENDPOINT: new URL(exporterUrl).origin,
      },
      service: "platform-api",
      mode: "test",
      identity: { release: "proof", sourceSha: "a".repeat(40) },
    });
    owner.onTestFinished(() => telemetry.shutdown());
    const verifier = createLogtoAccessTokenVerifier({
      issuer,
      audience,
      jwksUrl,
    });
    const token = await keys.sign();
    expect(
      await telemetry.runJob(() => verifier.verifyAccount(token)),
    ).toMatchObject({ ok: true });
    await telemetry.flush();
    expect(calls).toBe(1);
    const wire = exported.join("\n");
    expect(wire).not.toContain("private-");
    expect(wire).not.toContain(jwksUrl);
    expect(wire).not.toContain(token);
    const traceSchema = z.object({
      resourceSpans: z.array(
        z.object({
          scopeSpans: z.array(
            z.object({
              spans: z.array(
                z.object({
                  spanId: z.string(),
                  name: z.string(),
                  attributes: z.array(z.object({ key: z.string() })),
                  events: z.array(z.unknown()).optional(),
                }),
              ),
            }),
          ),
        }),
      ),
    });
    const spans = exported.flatMap((body) => {
      const parsed = traceSchema.safeParse(JSON.parse(body));
      return parsed.success
        ? parsed.data.resourceSpans.flatMap((resource) =>
            resource.scopeSpans.flatMap((scope) => scope.spans),
          )
        : [];
    });
    expect(new Set(spans.map((span) => span.spanId)).size).toBe(1);
    expect(
      spans.every(
        (span) =>
          span.name === "logto jwks" &&
          (span.events?.length ?? 0) === 0 &&
          span.attributes.every((attribute) =>
            [
              "dependency.name",
              "dependency.operation",
              "dependency.outcome",
              "http.request.method",
              "http.response.status_code",
            ].includes(attribute.key),
          ),
      ),
    ).toBe(true);
    if (exportStatus === 503) {
      expect(telemetry.diagnostics().failedTraceExports).toBeGreaterThan(0);
      expect(telemetry.diagnostics().failedMetricExports).toBeGreaterThan(0);
    } else
      expect(telemetry.diagnostics()).toEqual({
        droppedSpans: 0,
        failedTraceExports: 0,
        failedMetricExports: 0,
      });
    expect(JSON.stringify(warnings.mock.calls)).not.toContain("private-");
  });
}

test("refused JWKS telemetry preserves a foreign context manager and native authentication", async (owner) => {
  const keys = await identity();
  const jwksUrl = await listen(owner, (request, response) => {
    request.resume();
    response.end(JSON.stringify({ keys: [keys.jwk] }));
  });
  const foreign = new AsyncLocalStorageContextManager().enable();
  let registered = false;
  let telemetry: ReturnType<typeof createTechnicalTelemetry> | undefined;
  try {
    registered = context.setGlobalContextManager(foreign);
    expect(registered).toBe(true);
    const spans = new InMemorySpanExporter();
    telemetry = createTechnicalTelemetry({
      enabled: true,
      service: "platform-api",
      environment: "test",
      release: "proof",
      sampleRatio: 1,
      exporters: {
        spans,
        metrics: new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE),
      },
    });
    const marker = createContextKey("JWKS foreign owner");
    const candidate = telemetry;
    const token = await keys.sign();
    await foreign.with(ROOT_CONTEXT.setValue(marker, "preserved"), () =>
      candidate.runJob(async () => {
        expect(
          await createLogtoAccessTokenVerifier({
            issuer,
            audience,
            jwksUrl,
          }).verifyAccount(token),
        ).toMatchObject({ ok: true });
        expect(context.active().getValue(marker)).toBe("preserved");
      }),
    );
    await telemetry.flush();
    expect(spans.getFinishedSpans()).toEqual([]);
    await telemetry.shutdown();
    foreign.with(ROOT_CONTEXT.setValue(marker, "preserved"), () =>
      expect(context.active().getValue(marker)).toBe("preserved"),
    );
  } finally {
    await telemetry?.shutdown();
    if (registered) context.disable();
    else foreign.disable();
  }
});

test("repeated JWKS SDK lifetimes preserve another enabled runtime lease", async (owner) => {
  const keys = await identity();
  let calls = 0;
  const jwksUrl = await listen(owner, (request, response) => {
    calls++;
    request.resume();
    response.end(JSON.stringify({ keys: [keys.jwk] }));
  });
  const token = await keys.sign();
  for (let index = 0; index < 3; index++) {
    const first = runtime(owner);
    const second = runtime(owner);
    await first.telemetry.runJob(() =>
      createLogtoAccessTokenVerifier({
        issuer,
        audience,
        jwksUrl,
      }).verifyAccount(token),
    );
    await first.telemetry.shutdown();
    expect(
      await second.telemetry.runJob(() =>
        createLogtoAccessTokenVerifier({
          issuer,
          audience,
          jwksUrl,
        }).verifyAccount(token),
      ),
    ).toMatchObject({ ok: true });
    await second.telemetry.flush();
    expect(second.spans.getFinishedSpans().map((span) => span.name)).toEqual([
      "logto jwks",
    ]);
    await second.telemetry.shutdown();
  }
  expect(calls).toBe(6);
});

test("the observation seam returns the original unread Response and rethrows the original native error", async (owner) => {
  const { telemetry, spans } = runtime(owner);
  const response = new Response('{"private":"private-body"}', { status: 200 });
  expect(
    await telemetry.runJob(() =>
      observeLogtoJwksRequest(() => Promise.resolve(response)),
    ),
  ).toBe(response);
  expect(response.bodyUsed).toBe(false);
  const original = new TypeError("private-native-error", {
    cause: "private-native-cause",
  });
  await expect(
    telemetry.runJob(() =>
      observeLogtoJwksRequest(() => Promise.reject(original)),
    ),
  ).rejects.toBe(original);
  await telemetry.flush();
  expect(
    JSON.stringify(
      spans.getFinishedSpans().map((span) => ({
        attributes: span.attributes,
        status: span.status,
        events: span.events,
      })),
    ),
  ).not.toContain("private-");
});
