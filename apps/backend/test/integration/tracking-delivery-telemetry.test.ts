import { once } from "node:events";
import { createServer, type RequestListener } from "node:http";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { expect, test, vi, onTestFinished } from "vitest";
import { z } from "zod";
import { parsePlatformConfig } from "../../src/config/platform-config.js";
import { createApiApplication } from "../../src/entrypoints/api/create-api-application.js";
import { requestSchema } from "../../src/modules/communications/communications-schema.generated.js";
import { registerFixedClock } from "../support/fixed-clock.js";
import { assertDeclaredResponse } from "../support/declared-api.js";
import { eventually } from "./setup/eventually.js";
import { createMigratedTestDatabase } from "./setup/test-database.js";

registerFixedClock();

const token = "private_tracking_token_sentinel_00000000000000";
const origin = "https://tracking-proof.example.test";
const budgetMilliseconds = 20_000;
const attributeSchema = z.object({
  key: z.string(),
  value: z.object({ stringValue: z.string().optional() }),
});
const exportSchema = z.object({
  resourceSpans: z
    .array(
      z.object({
        scopeSpans: z.array(
          z.object({
            spans: z.array(
              z.object({
                name: z.string(),
                kind: z.number(),
                traceId: z.string(),
                spanId: z.string(),
                parentSpanId: z.string().optional(),
                attributes: z.array(attributeSchema),
              }),
            ),
          }),
        ),
      }),
    )
    .optional(),
});
type Span = NonNullable<
  z.infer<typeof exportSchema>["resourceSpans"]
>[number]["scopeSpans"][number]["spans"][number];

/** Native API lifecycle, real PostgreSQL and the production five-second pump, without a test-owned job scope. */
async function fixture(mode: "on" | "off" | "exporter503" = "on") {
  const database = await createMigratedTestDatabase();
  const applications = new Set<NestFastifyApplication>();
  const releases: (() => Promise<void>)[] = [];
  const providerFailures: unknown[] = [];
  const exported: string[] = [];
  const calls: z.infer<typeof requestSchema>[] = [];
  const received = new Map<string, unknown>();
  let loseAck = false;
  let rejected = false;
  let hold: Promise<void> | undefined;
  let releaseHold: (() => void) | undefined;
  onTestFinished(async () => {
    const failures: unknown[] = [];
    releaseHold?.();
    for (const app of applications) {
      try {
        await app.close();
      } catch (error) {
        failures.push(error);
      }
    }
    for (const release of releases.reverse()) {
      try {
        await release();
      } catch (error) {
        failures.push(error);
      }
    }
    try {
      await database.dispose();
    } catch (error) {
      failures.push(error);
    }
    if (failures.length > 0)
      throw new AggregateError(failures, "Owned tracking proof cleanup failed");
  });
  async function listen(handler: RequestListener) {
    const server = createServer(handler);
    releases.push(async () => {
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
      throw new Error("Owned listener unavailable");
    return `http://127.0.0.1:${address.port}`;
  }
  const collector = await listen((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      body += chunk;
      if (body.length > 1_048_576) request.destroy();
    });
    request.on("end", () => {
      exported.push(body);
      response
        .writeHead(mode === "exporter503" ? 503 : 200, {
          "content-type": "application/json",
        })
        .end("{}");
    });
  });
  const provider = await listen((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      body += chunk;
      if (body.length > 16_384) request.destroy();
    });
    request.on("end", () => {
      void (async () => {
        try {
          expect(request.method).toBe("POST");
          expect(request.headers.authorization).toBe(
            "Bearer private-tracking-provider-secret",
          );
          for (const key of ["traceparent", "tracestate", "baggage"])
            expect(request.headers[key]).toBeUndefined();
          const command = requestSchema.parse(JSON.parse(body));
          if (command.operation === "tracking.resolve") {
            response.writeHead(200, { "content-type": "application/json" }).end(
              JSON.stringify({
                contractVersion: "inside-communications-v1",
                status: "ok",
                safeUrl: `${origin}/materials/proof-material`,
              }),
            );
            return;
          }
          if (command.operation !== "tracking.recordHit")
            throw new Error("Unexpected proof operation");
          calls.push(command);
          if (hold !== undefined) await hold;
          if (rejected) {
            response.writeHead(403, { "content-type": "application/json" }).end(
              JSON.stringify({
                contractVersion: "inside-communications-v1",
                status: "forbidden",
              }),
            );
            return;
          }
          const duplicate = received.has(command.payload.eventId);
          if (duplicate)
            expect(received.get(command.payload.eventId)).toEqual(command);
          received.set(command.payload.eventId, command);
          if (loseAck) {
            response.destroy();
            return;
          }
          response.writeHead(200, { "content-type": "application/json" }).end(
            JSON.stringify({
              contractVersion: "inside-communications-v1",
              status: "ok",
              eventId: command.payload.eventId,
              outcome: duplicate ? "duplicate" : "recorded",
            }),
          );
        } catch (error) {
          providerFailures.push(error);
          response.writeHead(500).end();
        }
      })();
    });
  });
  const environmentKeys = [
    ...Object.keys(process.env).filter((key) =>
      key.startsWith("OTEL_EXPORTER_OTLP"),
    ),
    "INSIDE_OTEL_ENABLED",
    "INSIDE_OTEL_ENDPOINT",
    "INSIDE_OTEL_SAMPLE_RATIO",
  ];
  releases.unshift(() => {
    vi.unstubAllEnvs();
    return Promise.resolve();
  });
  for (const key of environmentKeys) vi.stubEnv(key, undefined);
  vi.stubEnv("INSIDE_OTEL_ENABLED", mode === "off" ? "false" : "true");
  vi.stubEnv("INSIDE_OTEL_ENDPOINT", collector);
  vi.stubEnv("INSIDE_OTEL_SAMPLE_RATIO", "1");
  const config = parsePlatformConfig({
    NODE_ENV: "test",
    DATABASE_URL: database.url,
    LOGTO_ISSUER: "https://tracking-proof.example.test/oidc",
    LOGTO_AUDIENCE: "https://api.tracking-proof.example.test",
    LOGTO_JWKS_URL: provider + "/unused-jwks",
    IDENTITY_EMAIL_FINGERPRINT_KEY: "synthetic-tracking-proof-fingerprint-key",
    TELEGRAM_TRACKING_ORIGIN: origin,
    TELEGRAM_COMMUNICATIONS_ENDPOINT:
      provider + "/integrations/platform/v1/communications",
    TELEGRAM_COMMUNICATIONS_SECRET: "private-tracking-provider-secret",
    TELEGRAM_AUTHOR_AUTHORIZATION_SECRET: "private-tracking-author-secret",
    TELEGRAM_COMMUNICATIONS_BOT_IDENTITY: "tracking_proof_bot",
  });
  async function start() {
    const app = await createApiApplication(config, { logger: false });
    applications.add(app);
    await app.listen(0, "127.0.0.1");
    return app;
  }
  async function close(app: NestFastifyApplication) {
    await app.close();
    applications.delete(app);
  }
  async function resolve(app: NestFastifyApplication) {
    const response = await fetch(
      (await app.getUrl()) + "/communications/tracking/resolve",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, traffic: "unknown" }),
        signal: AbortSignal.timeout(budgetMilliseconds),
      },
    );
    const body: unknown = await response.json();
    assertDeclaredResponse({
      method: "POST",
      url: "/communications/tracking/resolve",
      status: response.status,
      body: () => body,
    });
    expect(response.status).toBe(200);
    expect(body).toEqual({
      kind: "resolved",
      safeUrl: `${origin}/materials/proof-material`,
    });
  }
  async function delivered(count: number) {
    await eventually(async () => {
      expect(
        await database.prisma.communicationTrackingHit.count({
          where: { deliveredAt: { not: null } },
        }),
      ).toBe(count);
    }, budgetMilliseconds);
  }
  function spans(): Span[] {
    const parsed = exported.map((body) => exportSchema.parse(JSON.parse(body)));
    return [
      ...new Map(
        parsed
          .flatMap(
            (doc) =>
              doc.resourceSpans?.flatMap((resource) =>
                resource.scopeSpans.flatMap((scope) => scope.spans),
              ) ?? [],
          )
          .map((span) => [span.traceId + "/" + span.spanId, span]),
      ).values(),
    ];
  }
  function assertPrivacy() {
    expect(providerFailures).toEqual([]);
    for (const value of [
      token,
      "private-",
      provider,
      origin,
      ...received.keys(),
    ])
      expect(exported.join("\n")).not.toContain(value);
    for (const span of spans().filter(
      (span) => span.name === "tracking deliver",
    ))
      expect(span.attributes.map((attribute) => attribute.key).sort()).toEqual([
        "tracking.operation",
        "tracking.outcome",
      ]);
  }
  return {
    database,
    start,
    close,
    resolve,
    delivered,
    spans,
    assertPrivacy,
    calls,
    received,
    exported,
    setLoseAck: (value: boolean) => {
      loseAck = value;
    },
    setRejected: (value: boolean) => {
      rejected = value;
    },
    holdProvider: () => {
      hold = new Promise<void>((resolve) => {
        releaseHold = resolve;
      });
      return () => releaseHold?.();
    },
  };
}

test("production HTTP resolve persists causality and timer delivery resumes that exact request", async () => {
  const proof = await fixture();
  const app = await proof.start();
  await proof.resolve(app);
  const row =
    await proof.database.prisma.communicationTrackingHit.findFirstOrThrow();
  expect(row.traceparent).toMatch(/^00-[a-f0-9]{32}-[a-f0-9]{16}-01$/u);
  await proof.delivered(1);
  await proof.close(app);
  const delivery = proof
    .spans()
    .find((span) => span.name === "tracking deliver");
  expect(delivery).toBeDefined();
  const source = proof
    .spans()
    .find((span) => span.name === "POST /communications/tracking/resolve");
  expect(delivery?.traceId).toBe(source?.traceId);
  expect(delivery?.parentSpanId).toBe(source?.spanId);
  const client = proof
    .spans()
    .find(
      (span) =>
        span.name === "telegram communications.execute" &&
        span.parentSpanId === delivery?.spanId,
    );
  expect(client).toBeDefined();
  expect(proof.calls).toHaveLength(1);
  proof.assertPrivacy();
});

test.each(["off", "exporter503"] as const)(
  "production timer preserves delivery with telemetry %s",
  async (mode) => {
    const proof = await fixture(mode);
    const app = await proof.start();
    await proof.resolve(app);
    const row =
      await proof.database.prisma.communicationTrackingHit.findFirstOrThrow();
    if (mode === "off") expect(row.traceparent).toBeNull();
    await proof.delivered(1);
    await proof.close(app);
    expect(proof.calls).toHaveLength(1);
    if (mode === "off") expect(proof.exported).toEqual([]);
    proof.assertPrivacy();
  },
);

test("lost provider ACK survives API restart with the same event, payload and original HTTP carrier", async () => {
  const proof = await fixture();
  const first = await proof.start();
  await proof.resolve(first);
  const before =
    await proof.database.prisma.communicationTrackingHit.findFirstOrThrow();
  proof.setLoseAck(true);
  await eventually(async () => {
    const row =
      await proof.database.prisma.communicationTrackingHit.findUniqueOrThrow({
        where: { eventId: before.eventId },
      });
    expect(proof.calls).toHaveLength(1);
    expect(row.claimId).toBeNull();
    expect(row.deliveredAt).toBeNull();
    expect(+row.availableAt - +before.availableAt).toBe(30_000);
  }, budgetMilliseconds);
  await proof.close(first);
  proof.setLoseAck(false);
  vi.setSystemTime(new Date(+before.availableAt + 30_000));
  const restarted = await proof.start();
  await proof.delivered(1);
  await proof.close(restarted);
  expect(proof.calls).toHaveLength(2);
  expect(proof.calls[0]).toEqual(proof.calls[1]);
  expect(proof.received.size).toBe(1);
  const after =
    await proof.database.prisma.communicationTrackingHit.findUniqueOrThrow({
      where: { eventId: before.eventId },
    });
  expect(after.traceparent).toBe(before.traceparent);
  const deliveries = proof
    .spans()
    .filter((span) => span.name === "tracking deliver");
  expect(deliveries).toHaveLength(2);
  expect(new Set(deliveries.map((span) => span.spanId)).size).toBe(2);
  expect(new Set(deliveries.map((span) => span.traceId)).size).toBe(1);
  expect(new Set(deliveries.map((span) => span.parentSpanId)).size).toBe(1);
  expect(
    deliveries.map(
      (span) =>
        span.attributes.find((item) => item.key === "tracking.outcome")?.value
          .stringValue,
    ),
  ).toEqual(["failed", "completed"]);
  proof.assertPrivacy();
});

test("two real API pumps claim one hit while historical NULL and invalid carriers still deliver", async () => {
  const proof = await fixture();
  const first = await proof.start();
  const second = await proof.start();
  await proof.resolve(first);
  await proof.database.prisma.communicationTrackingHit.updateMany({
    data: { traceparent: null },
  });
  await proof.resolve(second);
  const invalid =
    await proof.database.prisma.communicationTrackingHit.findFirstOrThrow({
      where: { traceparent: { not: null } },
    });
  await proof.database.prisma.communicationTrackingHit.update({
    where: { eventId: invalid.eventId },
    data: { traceparent: "private-invalid-carrier" },
  });
  await proof.delivered(2);
  await proof.close(first);
  await proof.close(second);
  expect(proof.calls).toHaveLength(2);
  expect(proof.received.size).toBe(2);
  const deliveries = proof
    .spans()
    .filter((span) => span.name === "tracking deliver");
  expect(deliveries).toHaveLength(2);
  expect(
    deliveries.every(
      (span) => span.parentSpanId === undefined || span.parentSpanId === "",
    ),
  ).toBe(true);
  proof.assertPrivacy();
});

test("negative provider result retains the original retry delay and failed attempt observation", async () => {
  const proof = await fixture();
  const app = await proof.start();
  await proof.resolve(app);
  const before =
    await proof.database.prisma.communicationTrackingHit.findFirstOrThrow();
  proof.setRejected(true);
  await eventually(async () => {
    const row =
      await proof.database.prisma.communicationTrackingHit.findUniqueOrThrow({
        where: { eventId: before.eventId },
      });
    expect(proof.calls).toHaveLength(1);
    expect(row.claimId).toBeNull();
    expect(row.deliveredAt).toBeNull();
    expect(+row.availableAt - +before.availableAt).toBe(30_000);
  }, budgetMilliseconds);
  await proof.close(app);
  const deliveries = proof
    .spans()
    .filter((span) => span.name === "tracking deliver");
  expect(deliveries).toHaveLength(1);
  expect(
    deliveries[0]?.attributes.find((item) => item.key === "tracking.outcome")
      ?.value.stringValue,
  ).toBe("failed");
  proof.assertPrivacy();
});

test("API shutdown awaits the active claimed delivery before the SDK closes", async () => {
  const proof = await fixture();
  const app = await proof.start();
  const release = proof.holdProvider();
  await proof.resolve(app);
  await eventually(() => {
    expect(proof.calls).toHaveLength(1);
    return Promise.resolve();
  }, budgetMilliseconds);
  let stopped = false;
  const closing = proof.close(app).then(() => {
    stopped = true;
  });
  await Promise.resolve();
  expect(stopped).toBe(false);
  release();
  await closing;
  expect(
    await proof.database.prisma.communicationTrackingHit.count({
      where: { deliveredAt: { not: null } },
    }),
  ).toBe(1);
  expect(
    proof.spans().filter((span) => span.name === "tracking deliver"),
  ).toHaveLength(1);
  proof.assertPrivacy();
});
