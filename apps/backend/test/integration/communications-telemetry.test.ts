import { once } from "node:events";
import { createServer, type RequestListener, type Server } from "node:http";
import { Pool } from "pg";
import { expect, test, vi, type TestContext } from "vitest";
import { z } from "zod";
import { PublicContentTargets } from "../../src/modules/materials/index.js";
import { TrackingVisits } from "../../src/modules/communications/facets/tracking-visits/tracking-visits.js";
import { HttpCommunicationsProvider } from "../../src/modules/communications/infrastructure/http-communications-provider.js";
import { requestSchema } from "../../src/modules/communications/communications-schema.generated.js";
import { technicalTelemetryFromEnvironment } from "../../src/infrastructure/observability/technical-telemetry-runtime.js";
import {
  createMigratedTestDatabase,
  createTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

function barrier() {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

/** Register cleanup before acquisition; provider I/O settles before SDK/pools/databases close. */
function resources(owner: TestContext) {
  const databases: TestDatabase[] = [];
  const pools: Pool[] = [];
  const servers: { server: Server; role: "provider" | "collector" }[] = [];
  const pending = new Set<Promise<unknown>>();
  const releaseAck = barrier();
  let telemetry:
    ReturnType<typeof technicalTelemetryFromEnvironment> | undefined;
  async function close(role: "provider" | "collector") {
    for (const entry of servers.filter((entry) => entry.role === role)) {
      entry.server.closeAllConnections();
      if (entry.server.listening)
        await new Promise<void>((resolve, reject) =>
          entry.server.close((error) =>
            error === undefined ? resolve() : reject(error),
          ),
        );
    }
  }
  owner.onTestFinished(async () => {
    const failures: unknown[] = [];
    async function attempt(work: () => Promise<unknown>) {
      try {
        await work();
      } catch (error) {
        failures.push(error);
      }
    }
    releaseAck.resolve();
    await attempt(() => close("provider"));
    await attempt(async () => {
      while (pending.size > 0) await Promise.allSettled([...pending]);
    });
    await attempt(async () => {
      await telemetry?.shutdown();
    });
    await attempt(() => close("collector"));
    for (const pool of pools) await attempt(() => pool.end());
    for (const database of [...databases].reverse())
      await attempt(() => database.dispose());
    if (failures.length > 0)
      throw new AggregateError(failures, "Owned tracking proof cleanup failed");
  });
  return {
    databases,
    pools,
    releaseAck,
    setTelemetry(value: ReturnType<typeof technicalTelemetryFromEnvironment>) {
      telemetry = value;
    },
    track<Value>(work: () => Promise<Value>) {
      const task = Promise.resolve().then(work);
      pending.add(task);
      void task.then(
        () => pending.delete(task),
        () => pending.delete(task),
      );
      return task;
    },
    async listen(role: "provider" | "collector", handler: RequestListener) {
      const server = createServer(handler);
      servers.push({ server, role });
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const address = server.address();
      if (address === null || typeof address === "string")
        throw new Error("owned listener unavailable");
      return `http://127.0.0.1:${address.port}`;
    },
  };
}

const spanSchema = z.object({
  traceId: z.string(),
  spanId: z.string(),
  name: z.string(),
  kind: z.number(),
  attributes: z.array(
    z.object({
      key: z.string(),
      value: z.object({
        stringValue: z.string().optional(),
        intValue: z.union([z.string(), z.number()]).optional(),
      }),
    }),
  ),
  events: z.array(z.unknown()).optional(),
});
const exportSchema = z.object({
  resourceSpans: z
    .array(
      z.object({
        scopeSpans: z.array(z.object({ spans: z.array(spanSchema) })),
      }),
    )
    .optional(),
  resourceMetrics: z
    .array(
      z.object({
        scopeMetrics: z.array(
          z.object({
            metrics: z.array(
              z.object({
                name: z.string(),
                sum: z
                  .object({
                    dataPoints: z.array(
                      z.object({
                        asDouble: z.number(),
                        attributes: z.array(
                          z.object({
                            key: z.string(),
                            value: z.object({ stringValue: z.string() }),
                          }),
                        ),
                      }),
                    ),
                  })
                  .optional(),
              }),
            ),
          }),
        ),
      }),
    )
    .optional(),
});

for (const mode of ["enabled", "off", "export-failure"] as const) {
  test(`real PostgreSQL tracking claims and native HTTP retain one event across lost ACK and a new instance with ${mode}`, async (owner) => {
    const owned = resources(owner);
    const database = await createMigratedTestDatabase();
    owned.databases.push(database);
    const receiverDatabase = await createTestDatabase();
    owned.databases.push(receiverDatabase);
    // This is the separately owned provider database, not capability SQL or a Platform migration.
    const receiver = new Pool({
      connectionString: receiverDatabase.url,
      max: 1,
    });
    owned.pools.push(receiver);
    const audit = new Pool({ connectionString: receiverDatabase.url, max: 1 });
    owned.pools.push(audit);
    await receiver.query(
      "CREATE TABLE proof_tracking_receiver (event_id uuid PRIMARY KEY, envelope text NOT NULL)",
    );
    const origin = "https://inside.test";
    const safeUrl = `${origin}/materials/private-tracking-target`;
    const token = "a".repeat(43);
    const secret = "private-communications-secret";
    const committed = barrier();
    const calls: {
      serialized: string;
      operation: string;
      eventId?: string;
      authorization: string | undefined;
      traceparent: string | string[] | undefined;
    }[] = [];
    const receiverErrors: unknown[] = [];
    let dropFirstAck = true;
    const endpoint = await owned.listen("provider", (request, response) => {
      let serialized = "";
      request.setEncoding("utf8");
      request.on("data", (chunk: string) => {
        serialized += chunk;
        if (serialized.length > 65_536) request.destroy();
      });
      request.on("end", () => {
        void owned
          .track(async () => {
            const input: unknown = JSON.parse(serialized);
            const parsed = requestSchema.parse(input);
            if (
              request.method !== "POST" ||
              request.url !== "/integrations/platform/v1/communications"
            )
              throw new Error("unexpected provider route");
            calls.push({
              serialized,
              operation: parsed.operation,
              authorization: request.headers.authorization,
              traceparent: request.headers["traceparent"],
              ...(parsed.operation === "tracking.recordHit"
                ? { eventId: parsed.payload.eventId }
                : {}),
            });
            if (parsed.operation === "tracking.resolve") {
              response
                .writeHead(200, { "content-type": "application/json" })
                .end(
                  JSON.stringify({
                    contractVersion: "inside-communications-v1",
                    status: "ok",
                    safeUrl,
                  }),
                );
              return;
            }
            if (parsed.operation !== "tracking.recordHit")
              throw new Error("unexpected provider operation");
            const inserted = await receiver.query(
              "INSERT INTO proof_tracking_receiver(event_id, envelope) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING event_id",
              [parsed.payload.eventId, serialized],
            );
            const persisted = z
              .array(z.object({ envelope: z.string() }))
              .parse(
                (
                  await receiver.query(
                    "SELECT envelope FROM proof_tracking_receiver WHERE event_id=$1",
                    [parsed.payload.eventId],
                  )
                ).rows,
              );
            expect(persisted).toEqual([{ envelope: serialized }]);
            if (dropFirstAck) {
              dropFirstAck = false;
              // INSERT has committed before a second independent connection can observe this barrier.
              committed.resolve();
              await owned.releaseAck.promise;
              request.socket.destroy();
              return;
            }
            response.writeHead(200, { "content-type": "application/json" }).end(
              JSON.stringify({
                contractVersion: "inside-communications-v1",
                status: "ok",
                eventId: parsed.payload.eventId,
                outcome: inserted.rowCount === 0 ? "duplicate" : "recorded",
              }),
            );
          })
          .catch((error: unknown) => {
            receiverErrors.push(error);
            response.destroy();
          });
      });
    });
    const wire: string[] = [];
    let oversized = false;
    const exporter = await owned.listen("collector", (request, response) => {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk: string) => {
        body += chunk;
        if (body.length > 1_048_576) {
          oversized = true;
          request.destroy();
        }
      });
      request.on("end", () => {
        if (wire.length >= 32) {
          oversized = true;
          request.destroy();
          return;
        }
        wire.push(body);
        response
          .writeHead(mode === "export-failure" ? 503 : 200, {
            "content-type": "application/json",
            "Retry-After": "Thu, 01 Jan 1970 00:00:00 GMT",
          })
          .end("{}");
      });
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
    const errors = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    owner.onTestFinished(() => {
      errors.mockRestore();
    });
    const telemetry = technicalTelemetryFromEnvironment({
      environment: {
        INSIDE_OTEL_ENABLED: mode === "off" ? "false" : "true",
        INSIDE_OTEL_ENDPOINT: exporter,
        INSIDE_OTEL_SAMPLE_RATIO: "1",
      },
      service: "platform-api",
      mode: "test",
      identity: { release: "a".repeat(40), sourceSha: "a".repeat(40) },
    });
    owned.setTelemetry(telemetry);
    let now = new Date("2026-10-20T09:00:00Z");
    function visits() {
      return new TrackingVisits(
        database.prisma,
        new HttpCommunicationsProvider({
          endpoint: `${endpoint}/integrations/platform/v1/communications`,
          secret,
          authorizationSecret: "private-authorization-secret",
          botIdentity: "private-bot",
        }),
        origin,
        new PublicContentTargets(database.prisma),
        undefined,
        () => now,
      );
    }
    // Explicit test-owned technical scope; this does not exercise a real API/JWT or TrackingHitPump root.
    const scoped = <Value>(work: () => Promise<Value>) =>
      owned.track(() => telemetry.runJob(work));
    await expect(
      scoped(() => visits().resolve({ token, traffic: "unknown" })),
    ).resolves.toEqual({ kind: "resolved", safeUrl });
    expect(await visits().backlog()).toEqual({
      kind: "ready",
      pending: 1,
      oldestAgeSeconds: 0,
    });
    const event =
      await database.prisma.communicationTrackingHit.findFirstOrThrow();
    const first = scoped(() => visits().deliverPending());
    const second = scoped(() => visits().deliverPending());
    await committed.promise;
    // One loser has finished while the single winning claim waits for its lost socket ACK.
    await Promise.race([first, second]);
    const receiverCommit = z
      .array(z.object({ event_id: z.string(), envelope: z.string() }))
      .parse(
        (
          await audit.query(
            "SELECT event_id, envelope FROM proof_tracking_receiver",
          )
        ).rows,
      );
    expect(receiverCommit).toHaveLength(1);
    expect(receiverCommit[0]?.event_id).toBe(event.eventId);
    const claim =
      await database.prisma.communicationTrackingHit.findUniqueOrThrow({
        where: { eventId: event.eventId },
      });
    expect(claim.claimId).not.toBeNull();
    expect(claim.deliveredAt).toBeNull();
    expect(claim.availableAt).toEqual(new Date(+now + 60_000));
    expect(
      calls.filter((call) => call.operation === "tracking.recordHit"),
    ).toHaveLength(1);
    owned.releaseAck.resolve();
    await Promise.all([first, second]);
    const pending =
      await database.prisma.communicationTrackingHit.findUniqueOrThrow({
        where: { eventId: event.eventId },
      });
    expect(pending.claimId).toBeNull();
    expect(pending.deliveredAt).toBeNull();
    expect(pending.availableAt).toEqual(new Date(+now + 30_000));
    // Advance only the injected business clock; I/O, AbortSignal and SDK timers retain real time.
    now = new Date(+now + 120_000);
    const restarted = visits();
    await scoped(() => restarted.deliverPending());
    await scoped(() => visits().deliverPending());
    expect(await restarted.backlog()).toEqual({
      kind: "ready",
      pending: 0,
      oldestAgeSeconds: 0,
    });
    const delivered =
      await database.prisma.communicationTrackingHit.findUniqueOrThrow({
        where: { eventId: event.eventId },
      });
    expect(delivered.eventId).toBe(event.eventId);
    expect(delivered.deliveredAt).toEqual(now);
    expect(delivered.claimId).toBeNull();
    const hits = calls.filter(
      (call) => call.operation === "tracking.recordHit",
    );
    expect(calls).toHaveLength(3);
    expect(hits).toHaveLength(2);
    expect(hits[0]?.serialized).toBe(hits[1]?.serialized);
    expect(hits[0]?.eventId).toBe(event.eventId);
    expect(receiverCommit[0]?.envelope).toBe(hits[0]?.serialized);
    expect(
      z
        .array(z.object({ count: z.string() }))
        .parse(
          (
            await audit.query(
              "SELECT count(*)::text AS count FROM proof_tracking_receiver",
            )
          ).rows,
        ),
    ).toEqual([{ count: "1" }]);
    for (const call of calls) {
      expect(call.authorization).toBe(`Bearer ${secret}`);
      expect(call.traceparent).toBeUndefined();
    }
    expect(receiverErrors).toEqual([]);
    await telemetry.flush();
    expect(oversized).toBe(false);
    if (mode === "off") {
      expect(wire).toEqual([]);
    } else {
      const parsed = wire.map((body) => exportSchema.parse(JSON.parse(body)));
      const spans = parsed.flatMap(
        (body) =>
          body.resourceSpans?.flatMap((resource) =>
            resource.scopeSpans.flatMap((scope) => scope.spans),
          ) ?? [],
      );
      const unique = new Map<string, z.infer<typeof spanSchema>>();
      for (const span of spans) {
        if (unique.has(span.spanId))
          expect(span).toEqual(unique.get(span.spanId));
        unique.set(span.spanId, span);
        expect([
          "telegram communications.execute",
          "postgresql query",
          "postgresql acquire",
        ]).toContain(span.name);
        expect(span.kind).toBe(3);
        expect(span.events ?? []).toEqual([]);
        const allowed = new Set([
          "dependency.name",
          "dependency.operation",
          "dependency.outcome",
          ...(span.name.startsWith("telegram ")
            ? ["http.request.method", "http.response.status_code"]
            : []),
        ]);
        expect(
          span.attributes.every((attribute) => allowed.has(attribute.key)),
        ).toBe(true);
        expect(
          new Set(span.attributes.map((attribute) => attribute.key)).size,
        ).toBe(span.attributes.length);
        const attributes = Object.fromEntries(
          span.attributes.map((attribute) => [attribute.key, attribute.value]),
        );
        expect(attributes["dependency.name"]).toEqual({
          stringValue: span.name.startsWith("telegram ")
            ? "telegram"
            : "postgresql",
        });
        expect(attributes["dependency.operation"]).toEqual({
          stringValue: span.name.startsWith("telegram ")
            ? "communications.execute"
            : span.name.slice("postgresql ".length),
        });
        expect(["completed", "failed"]).toContain(
          attributes["dependency.outcome"]?.stringValue,
        );
        if (span.name.startsWith("telegram "))
          expect(attributes["http.request.method"]).toEqual({
            stringValue: "POST",
          });
      }
      const communications = [...unique.values()].filter(
        (span) => span.name === "telegram communications.execute",
      );
      expect(communications).toHaveLength(3);
      expect(
        communications
          .map(
            (span) =>
              span.attributes.find(
                (attribute) => attribute.key === "dependency.outcome",
              )?.value.stringValue,
          )
          .sort(),
      ).toEqual(["completed", "completed", "failed"]);
      const counters = parsed
        .flatMap(
          (body) =>
            body.resourceMetrics?.flatMap((resource) =>
              resource.scopeMetrics.flatMap((scope) => scope.metrics),
            ) ?? [],
        )
        .filter((metric) => metric.name === "inside.dependency.operations")
        .flatMap((metric) => metric.sum?.dataPoints ?? []);
      const cumulative = new Map<string, number>();
      for (const point of counters) {
        const labels = Object.fromEntries(
          point.attributes.map((attribute) => [
            attribute.key,
            attribute.value.stringValue,
          ]),
        );
        expect(Object.keys(labels).sort()).toEqual([
          "dependency",
          "operation",
          "outcome",
        ]);
        expect(["telegram", "postgresql"]).toContain(labels["dependency"]);
        expect(["completed", "failed"]).toContain(labels["outcome"]);
        if (labels["dependency"] === "postgresql")
          expect(["query", "acquire"]).toContain(labels["operation"]);
        if (labels["dependency"] === "telegram") {
          expect(labels["operation"]).toBe("communications.execute");
          expect(["completed", "failed"]).toContain(labels["outcome"]);
          const outcome = labels["outcome"];
          if (outcome !== undefined)
            cumulative.set(
              outcome,
              Math.max(cumulative.get(outcome) ?? 0, point.asDouble),
            );
        }
      }
      expect(Object.fromEntries(cumulative)).toEqual({
        completed: 2,
        failed: 1,
      });
      const exported = wire.join("\n");
      for (const privateValue of [
        token,
        secret,
        safeUrl,
        endpoint,
        event.eventId,
        "private-",
      ])
        expect(exported).not.toContain(privateValue);
      if (mode === "export-failure") {
        expect(telemetry.diagnostics().failedTraceExports).toBeGreaterThan(0);
        expect(telemetry.diagnostics().failedMetricExports).toBeGreaterThan(0);
      } else
        expect(telemetry.diagnostics()).toEqual({
          droppedSpans: 0,
          failedTraceExports: 0,
          failedMetricExports: 0,
        });
    }
    const logging = JSON.stringify([warnings.mock.calls, errors.mock.calls]);
    expect(logging).not.toContain(token);
    expect(logging).not.toContain(secret);
  });
}
