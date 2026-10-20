import { Pool } from "pg";
import { createTestDatabase } from "./setup/test-database.js";
import {
  runMigrationsToLatest,
  verifyMigrationState,
} from "../../src/infrastructure/postgres/migrate-to-latest.js";
import { platformMigrations } from "../../src/migrations/index.js";
import {
  migrateRuntimeDatabase,
  verifyRuntimeDatabaseSchema,
  runtimeDatabaseSchemaIdentity,
} from "../../src/migrations/migrate.js";
import { z } from "zod";
import { technicalTelemetryFromEnvironment } from "../../src/infrastructure/observability/technical-telemetry-runtime.js";
import {
  launchQueueTelemetryProcess,
  boundedProcessFact,
  type QueueTelemetryProcess,
} from "./setup/queue-telemetry-process.js";
import { queueDepth, queueConsumers } from "./setup/broker.js";
import { lanes } from "../../src/infrastructure/notification-transport/wire.js";
import { encodeNotification } from "../../src/infrastructure/notification-transport/wire.js";
import { assembleNotificationTransport } from "../../src/modules/notifications/index.js";
import { once } from "node:events";
import { createServer } from "node:http";
import { vi } from "vitest";
import { startNotificationBroker } from "./setup/broker.js";
import { localNotificationTopology } from "../../src/infrastructure/notification-transport/topology.js";
import {
  connectNotificationBroker,
  consumeNotificationLane,
  publishNotification,
} from "../../src/infrastructure/notification-transport/rabbitmq.js";
import { startTestIdentityIssuer } from "./setup/test-identity-issuer.js";
import { parsePlatformConfig } from "../../src/config/platform-config.js";
import { createApiApplication } from "../../src/entrypoints/api/create-api-application.js";
import { assembleMaterials } from "../../src/modules/materials/index.js";
import { Notifications } from "../../src/modules/notifications/index.js";
import { representativeDocument } from "../fixtures/material-body/representative.js";
import { eventually } from "./setup/eventually.js";
import { randomUUID } from "node:crypto";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import {
  AggregationTemporality,
  InMemoryMetricExporter,
} from "@opentelemetry/sdk-metrics";
import { expect, test, onTestFailed } from "vitest";
import fixtures from "../../../../docs/contracts/notifications-v1/fixtures.json" with { type: "json" };
import { createTechnicalTelemetry } from "../../src/infrastructure/observability/technical-telemetry.js";
import { assembleMaterialsNotificationOutbox } from "../../src/modules/materials/index.js";
import { stageMaterialsNotification } from "../../src/modules/materials/facets/notification-outbox/notification-outbox.js";
import { createMigratedTestDatabase } from "./setup/test-database.js";
import { finishFixtureCleanup } from "./setup/queue-telemetry-process.js";

const RECOVERY_FACT_BUDGET_MS = 25_000;
// A past HTTP-date requests immediate real OTLP retries without clocks, jitter or timeout overrides.
const IMMEDIATE_RETRY_HTTP_DATE = "Thu, 01 Jan 1970 00:00:00 GMT";
// Includes owned broker startup and six serial process start/reap boundaries plus durable fact waits.
const PUBLICATION_RECOVERY_BUDGET_MS = 240_000;
const spanSchema = z.looseObject({
  name: z.string(),
  traceId: z.string(),
  spanId: z.string(),
  parentSpanId: z.string().optional(),
});
const exportSchema = z.looseObject({
  resourceSpans: z
    .array(
      z.looseObject({
        scopeSpans: z.array(z.looseObject({ spans: z.array(spanSchema) })),
      }),
    )
    .optional(),
});
function exportedSpans(wire: readonly string[]) {
  return wire.flatMap(
    (body) =>
      exportSchema
        .parse(JSON.parse(body))
        .resourceSpans?.flatMap((resource) =>
          resource.scopeSpans.flatMap((scope) => scope.spans),
        ) ?? [],
  );
}

const materialFixture = fixtures.find(
  (fixture) => fixture.valid && fixture.definition === "materialEvent",
)?.value;
test("retains the first publication context across replay and relay attempts outside the business envelope", async () => {
  const database = await createMigratedTestDatabase();
  const spans = new InMemorySpanExporter();
  const telemetry = createTechnicalTelemetry({
    enabled: true,
    service: "platform-api",
    environment: "test",
    release: "context-proof",
    sampleRatio: 1,
    exporters: {
      spans,
      metrics: new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE),
    },
  });
  try {
    const event = { ...materialFixture, messageId: randomUUID() };
    const first = telemetry.startHttp({
      method: "PUT",
      route: "/authoring/materials/:materialId",
    });
    await first.run(() => stageMaterialsNotification(database.prisma, event));
    first.finish(200, 1);
    const second = telemetry.startHttp({
      method: "PUT",
      route: "/authoring/materials/:materialId",
    });
    await second.run(() => stageMaterialsNotification(database.prisma, event));
    second.finish(200, 1);
    const published: unknown[][] = [];
    await telemetry.runJob(() =>
      assembleMaterialsNotificationOutbox(database.prisma).relay(
        "materials",
        (...args) => {
          published.push(args);
          return Promise.resolve();
        },
      ),
    );
    expect(published).toHaveLength(1);
    expect(published[0]?.[1]).toMatchObject({
      traceparent: expect.any(String) as unknown,
    });
    await telemetry.flush();
    const http = spans
      .getFinishedSpans()
      .filter((span) => span.name.startsWith("PUT "));
    const publish = spans
      .getFinishedSpans()
      .find((span) => span.name === "publish materials");
    expect(publish?.parentSpanContext?.spanId).toBe(
      http[0]?.spanContext().spanId,
    );
    expect(publish?.spanContext().traceId).not.toBe(
      http[1]?.spanContext().traceId,
    );
  } finally {
    await finishFixtureCleanup([
      () => telemetry.shutdown(),
      () => database.dispose(),
    ]);
  }
});

// Genuine HTTP producer, public owner composition, real broker; no delivery-provider call.
test(
  "authenticated first publication survives broker relay and resumes its own durable audience context",
  async () => {
    type Stage =
      | "database_setup"
      | "collector_start"
      | "identity_start"
      | "broker_start"
      | "api_start"
      | "seed_audience"
      | "draft_create"
      | "http_authorization"
      | "http_publication"
      | "relay_failure"
      | "receipt_start"
      | "confirm_crash"
      | "receipt_committed"
      | "crashed_processes_stop"
      | "broker_consumers_drained"
      | "redelivery"
      | "relay_retry"
      | "broker_queue_drained"
      | "first_audience"
      | "resumed_audience"
      | "parallel_publications"
      | "api_close"
      | "trace_assertions"
      | "cleanup_children"
      | "cleanup_api"
      | "cleanup_broker"
      | "cleanup_identity"
      | "cleanup_collector"
      | "cleanup_database"
      | "cleanup_log_capture"
      | "cleanup_environment";
    let stage: Stage = "database_setup";
    let failedStage: Stage | undefined;
    onTestFailed(() => {
      process.stderr.write(
        `${JSON.stringify({ event: "notification_recovery_failure", stage, failedStage })}\n`,
      );
    });
    const cleanupAt = (owner: Stage, stop: () => unknown) => async () => {
      stage = owner;
      try {
        await stop();
      } catch (error) {
        failedStage ??= owner;
        throw error;
      }
    };
    const database = await createMigratedTestDatabase();
    const cleanup: (() => unknown)[] = [
      cleanupAt("cleanup_database", () => database.dispose()),
    ];
    const wire: string[] = [];
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    cleanup.push(cleanupAt("cleanup_log_capture", () => info.mockRestore()));
    try {
      stage = "collector_start";
      const collector = createServer((request, response) => {
        let body = "";
        request.setEncoding("utf8");
        request.on("data", (chunk: string) => {
          body += chunk;
        });
        request.on("end", () => {
          wire.push(body);
          response.writeHead(200, { "content-type": "application/json" });
          response.end("{}");
        });
      });
      collector.listen(0, "127.0.0.1");
      cleanup.unshift(
        cleanupAt(
          "cleanup_collector",
          () =>
            new Promise<void>((resolve, reject) =>
              collector.close((error) => (error ? reject(error) : resolve())),
            ),
        ),
      );
      await once(collector, "listening");
      const address = collector.address();
      if (address === null || typeof address === "string")
        throw new Error("collector address unavailable");
      const endpoint = `http://127.0.0.1:${address.port}`;
      vi.stubEnv("INSIDE_OTEL_ENABLED", "true");
      vi.stubEnv("INSIDE_OTEL_ENDPOINT", endpoint);
      cleanup.push(cleanupAt("cleanup_environment", () => vi.unstubAllEnvs()));
      stage = "identity_start";
      const identity = await startTestIdentityIssuer({
        issuer: "https://identity.example.test/oidc",
        audience: "https://api.example.test",
      });
      cleanup.unshift(cleanupAt("cleanup_identity", () => identity.close()));
      stage = "broker_start";
      const broker = await startNotificationBroker({
        topology: localNotificationTopology("inside-test", 100),
      });
      cleanup.unshift(cleanupAt("cleanup_broker", () => broker.stop()));
      stage = "api_start";
      const app = await createApiApplication(
        parsePlatformConfig({
          NODE_ENV: "test",
          DATABASE_URL: database.url,
          LOGTO_ISSUER: identity.issuer,
          LOGTO_AUDIENCE: identity.audience,
          LOGTO_JWKS_URL: identity.jwksUrl,
          NOTIFICATIONS_PLATFORM_ORIGIN: "https://inside.example.test",
          NOTIFICATIONS_TELEGRAM_SECRET: "synthetic-notification-secret-00000",
        }),
        { logger: false },
      );
      cleanup.unshift(cleanupAt("cleanup_api", () => app.close()));
      await app.listen(0, "127.0.0.1");
      const origin = await app.getUrl();
      stage = "seed_audience";
      const owner = randomUUID();
      const topic = randomUUID();
      const readers = Array.from({ length: 26 }, () => randomUUID());
      await database.prisma.account.createMany({
        data: [owner, ...readers].map((id) => ({
          id,
          logtoIssuer: identity.issuer,
          logtoSubject: id,
          createdAt: new Date("2026-01-01T00:00:00Z"),
        })),
      });
      await database.prisma.accountPermission.create({
        data: { accountId: owner, permission: "materials:manage" },
      });
      await database.prisma.topic.create({
        data: { id: topic, name: "Synthetic", slug: "synthetic" },
      });
      for (const id of [owner, ...readers]) {
        expect(
          await app.get(Notifications).changePreferences(id, {
            operationId: randomUUID(),
            expectedRevision: 0,
            email: true,
            telegram: false,
          }),
        ).toMatchObject({ ok: true });
      }
      const metadata = {
        title: "private-material-title-sentinel",
        summary: "private-summary-sentinel",
        access: "free" as const,
        topicId: topic,
        formatId: "guide",
        tagIds: [],
        difficulty: null,
        outcomes: [],
        seriesIds: [],
      };
      const body = representativeDocument("private-material-body-sentinel");
      const materials = assembleMaterials({
        prisma: database.prisma,
        authorPolicy: { canManage: (id) => id === owner },
      });
      stage = "draft_create";
      const draft = await materials.authoring.createDraft({
        actor: owner,
        idempotencyKey: randomUUID(),
        metadata,
        body,
      });
      if (!draft.ok) throw new Error(draft.error.code);
      const save = {
        expectedContentVersion: 1,
        publicationState: "published",
        metadata,
        body,
      };
      const token = await identity.sign(owner);
      const requestId = "original-http-publication-request";
      const url = `${origin}/authoring/materials/${draft.value.materialId}`;
      const headers = {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "idempotency-key": randomUUID(),
        "x-request-id": requestId,
      };
      stage = "http_authorization";
      expect(
        (
          await fetch(url, {
            method: "PUT",
            headers: {
              "content-type": "application/json",
              "idempotency-key": randomUUID(),
            },
            body: JSON.stringify(save),
          })
        ).status,
      ).toBe(401);
      const forbiddenToken = await identity.sign(
        readers[0] ?? "missing-reader",
      );
      expect(
        (
          await fetch(url, {
            method: "PUT",
            headers: { ...headers, authorization: `Bearer ${forbiddenToken}` },
            body: JSON.stringify(save),
          })
        ).status,
      ).toBe(403);
      expect(await database.prisma.materialNotificationOutbox.count()).toBe(0);
      stage = "http_publication";
      const response = await fetch(url, {
        method: "PUT",
        headers,
        body: JSON.stringify(save),
      });
      expect(response.status).toBe(200);
      expect(
        (
          await fetch(url, {
            method: "PUT",
            headers,
            body: JSON.stringify(save),
          })
        ).status,
      ).toBe(200);
      const sourceRows =
        await database.prisma.materialNotificationOutbox.findMany();
      expect(sourceRows).toHaveLength(1);
      const source = sourceRows[0];
      if (source === undefined) throw new Error("publication outbox absent");
      expect(source.traceparent).toEqual(expect.any(String) as unknown);
      const children: QueueTelemetryProcess[] = [];
      const launch = (
        action:
          | "fail-publish"
          | "confirm-crash"
          | "publish"
          | "accept-crash"
          | "accept"
          | "audience",
      ) => {
        const child = launchQueueTelemetryProcess({
          mode: "notification",
          action,
          databaseUrl: database.url,
          endpoint,
          urls: broker.urls,
        });
        children.push(child);
        return child;
      };
      cleanup.unshift(
        cleanupAt("cleanup_children", () =>
          finishFixtureCleanup(children.map((child) => () => child.stop())),
        ),
      );
      const record = z.object({
        kind: z.string(),
        pid: z.number().int().positive(),
      });
      const waitMessage = async (
        child: QueueTelemetryProcess,
        kind: string,
      ) => {
        await eventually(
          () =>
            Promise.resolve(
              expect(
                child.messages.some(
                  (message) => record.parse(message).kind === kind,
                ),
              ).toBe(true),
            ),
          RECOVERY_FACT_BUDGET_MS,
        );
      };
      const finish = async (child: QueueTelemetryProcess) =>
        expect(await boundedProcessFact(child.exited)).toEqual([0, null]);
      const kill = async (child: QueueTelemetryProcess) => {
        process.kill(
          record.parse(await boundedProcessFact(child.firstMessage)).pid,
          "SIGKILL",
        );
        await boundedProcessFact(child.exited);
        await child.stop();
      };
      stage = "relay_failure";
      const failed = launch("fail-publish");
      await waitMessage(failed, "publish-failed");
      await finish(failed);
      expect(
        await database.prisma.materialNotificationOutbox.findUniqueOrThrow({
          where: {
            scope_messageId: {
              scope: "materials",
              messageId: source.messageId,
            },
          },
        }),
      ).toMatchObject({
        attempts: 1,
        lastFailure: "publish_not_confirmed",
        publishedAt: null,
        traceparent: source.traceparent,
      });
      stage = "receipt_start";
      const receipt = launch("accept-crash");
      await waitMessage(receipt, "ready");
      stage = "confirm_crash";
      const confirmed = launch("confirm-crash");
      await waitMessage(confirmed, "confirmed");
      stage = "receipt_committed";
      await waitMessage(receipt, "accepted");
      const inbox = await database.prisma.notificationInbox.findUniqueOrThrow({
        where: {
          scope_messageId: { scope: "materials", messageId: source.messageId },
        },
      });
      expect(inbox).toMatchObject({
        payload: source.payload,
        digest: source.digest,
        traceparent: expect.any(String) as unknown,
        completedAt: null,
      });
      stage = "crashed_processes_stop";
      await kill(confirmed);
      await kill(receipt);
      stage = "broker_consumers_drained";
      await eventually(
        async () =>
          expect(
            await queueConsumers(
              broker.admin,
              "inside-test",
              lanes.materials.queue,
            ),
          ).toBe(0),
        RECOVERY_FACT_BUDGET_MS,
      );
      stage = "redelivery";
      const restarted = launch("accept");
      await waitMessage(restarted, "acknowledged");
      await finish(restarted);
      const duplicate = launch("accept");
      await waitMessage(duplicate, "ready");
      stage = "relay_retry";
      const retry = launch("publish");
      await waitMessage(retry, "published");
      await finish(retry);
      await waitMessage(duplicate, "acknowledged");
      await finish(duplicate);
      expect(
        await database.prisma.notificationInbox.findUniqueOrThrow({
          where: {
            scope_messageId: {
              scope: "materials",
              messageId: source.messageId,
            },
          },
        }),
      ).toMatchObject({
        traceparent: inbox.traceparent,
        digest: source.digest,
      });
      stage = "broker_queue_drained";
      await eventually(
        async () =>
          expect(
            await queueDepth(
              broker.admin,
              "inside-test",
              lanes.materials.queue,
            ),
          ).toBe(0),
        RECOVERY_FACT_BUDGET_MS,
      );
      // A distinct process resumes each batch of the persisted audience checkpoint.
      stage = "first_audience";
      const firstAudience = launch("audience");
      await finish(firstAudience);
      const checkpoint =
        await database.prisma.notificationInbox.findUniqueOrThrow({
          where: {
            scope_messageId: {
              scope: "materials",
              messageId: source.messageId,
            },
          },
        });
      expect(checkpoint.completedAt).toBeNull();
      expect(checkpoint.checkpoint).toMatchObject({
        recipients: 25,
        after: expect.any(String) as unknown,
      });
      stage = "resumed_audience";
      const resumedAudience = launch("audience");
      await finish(resumedAudience);
      expect(
        await database.prisma.notificationInbox.findUniqueOrThrow({
          where: {
            scope_messageId: {
              scope: "materials",
              messageId: source.messageId,
            },
          },
        }),
      ).toMatchObject({
        completedAt: expect.any(Date) as unknown,
        traceparent: inbox.traceparent,
      });
      const traceId = source.traceparent?.split("-")[1];
      stage = "parallel_publications";
      const parallel = await Promise.all(
        [0, 1].map(async (index) => {
          const parallelMetadata = {
            ...metadata,
            title: `private-parallel-title-${index}`,
          };
          const draft = await materials.authoring.createDraft({
            actor: owner,
            idempotencyKey: randomUUID(),
            metadata: parallelMetadata,
            body,
          });
          if (!draft.ok) throw new Error(draft.error.code);
          return { id: draft.value.materialId, metadata: parallelMetadata };
        }),
      );
      await Promise.all(
        parallel.map(async (draft) => {
          expect(
            (
              await fetch(`${origin}/authoring/materials/${draft.id}`, {
                method: "PUT",
                headers: { ...headers, "idempotency-key": randomUUID() },
                body: JSON.stringify({ ...save, metadata: draft.metadata }),
              })
            ).status,
          ).toBe(200);
        }),
      );
      const parents: string[] = [];
      for (const draft of parallel) {
        const announcement =
          await database.prisma.materialAnnouncement.findUniqueOrThrow({
            where: { materialId: draft.id },
          });
        const revision =
          await database.prisma.materialAnnouncementRevision.findUniqueOrThrow({
            where: {
              announcementRef_revision: {
                announcementRef: announcement.id,
                revision: 1,
              },
            },
          });
        const row =
          await database.prisma.materialNotificationOutbox.findUniqueOrThrow({
            where: {
              scope_messageId: {
                scope: "materials",
                messageId: revision.messageId,
              },
            },
          });
        expect(row.traceparent).toEqual(expect.any(String) as unknown);
        if (row.traceparent !== null) parents.push(row.traceparent);
      }
      expect(new Set(parents.map((parent) => parent.split("-")[1])).size).toBe(
        2,
      );
      expect(parents.every((parent) => parent.split("-")[1] !== traceId)).toBe(
        true,
      );
      const request = info.mock.calls
        .map(([line]) =>
          z
            .looseObject({
              event: z.string(),
              requestId: z.string().optional(),
              traceId: z.string().optional(),
            })
            .parse(JSON.parse(String(line))),
        )
        .find(
          (record) =>
            record.event === "request_completed" && record.traceId === traceId,
        );
      expect(z.uuid().safeParse(request?.requestId).success).toBe(true);
      expect(request?.requestId).not.toBe(requestId);
      expect(source.payload).not.toContain(requestId);
      stage = "api_close";
      await app.close();
      stage = "trace_assertions";
      const exported = wire.join("\n");
      const observed = exportedSpans(wire).filter((span) =>
        span.name.endsWith(" materials"),
      );
      expect(
        observed.filter((span) => span.name === "publish materials"),
      ).toHaveLength(2);
      expect(
        observed.filter((span) => span.name === "receive materials"),
      ).toHaveLength(2);
      const audience = observed.filter(
        (span) => span.name === "audience materials",
      );
      expect(audience).toHaveLength(2);
      expect(new Set(observed.map((span) => span.spanId)).size).toBe(
        observed.length,
      );
      expect(observed.every((span) => span.traceId === traceId)).toBe(true);
      expect(
        audience.every(
          (span) => span.parentSpanId === inbox.traceparent?.split("-")[2],
        ),
      ).toBe(true);
      expect(exported).toContain(traceId);
      for (const sentinel of [
        "private-material-title-sentinel",
        "private-summary-sentinel",
        "private-material-body-sentinel",
        token,
        owner,
        ...readers,
      ])
        expect(exported).not.toContain(sentinel);
    } catch (error) {
      failedStage ??= stage;
      throw error;
    } finally {
      await finishFixtureCleanup(cleanup);
    }
  },
  PUBLICATION_RECOVERY_BUDGET_MS,
);

test("legacy NULL context, concurrent duplicates, invalid metadata and rollback never reattribute the business row", async () => {
  const database = await createMigratedTestDatabase();
  const telemetry = createTechnicalTelemetry({
    enabled: true,
    service: "platform-api",
    environment: "test",
    release: "replay-proof",
    sampleRatio: 1,
    exporters: {
      spans: new InMemorySpanExporter(),
      metrics: new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE),
    },
  });
  try {
    const event = { ...materialFixture, messageId: randomUUID() };
    await stageMaterialsNotification(database.prisma, event);
    const request = telemetry.startHttp({
      method: "PUT",
      route: "/authoring/materials/:materialId",
    });
    await request.run(async () => {
      await Promise.all(
        Array.from({ length: 4 }, () =>
          stageMaterialsNotification(database.prisma, event),
        ),
      );
      const rolledBack = { ...event, messageId: randomUUID() };
      await expect(
        database.prisma.$transaction(async (transaction) => {
          await stageMaterialsNotification(transaction, rolledBack);
          throw new Error("rollback-proof");
        }),
      ).rejects.toThrow("rollback-proof");
    });
    request.finish(200, 1);
    expect(
      await database.prisma.materialNotificationOutbox.findMany(),
    ).toMatchObject([{ traceparent: null }]);
    const envelope = encodeNotification("materials", event);
    const transport = assembleNotificationTransport(database.prisma, 10);
    expect(await transport.accept(envelope)).toBe("accepted");
    const valid = "00-11111111111111111111111111111111-2222222222222222-01";
    expect(
      await Promise.all(
        Array.from({ length: 4 }, () =>
          transport.accept(envelope, { traceparent: valid }),
        ),
      ),
    ).toEqual(["duplicate", "duplicate", "duplicate", "duplicate"]);
    expect(await database.prisma.notificationInbox.findMany()).toMatchObject([
      { traceparent: null, payload: envelope.payload, digest: envelope.digest },
    ]);
    for (const value of [
      null,
      4,
      [valid],
      { toString: () => valid },
      Buffer.from(valid),
      `${valid}secret`,
      "x".repeat(1_000_000),
      "00-00000000000000000000000000000000-2222222222222222-01",
    ]) {
      const next = encodeNotification("materials", {
        ...event,
        messageId: randomUUID(),
      });
      expect(await transport.accept(next, { traceparent: value })).toBe(
        "accepted",
      );
      expect(
        await database.prisma.notificationInbox.findUniqueOrThrow({
          where: {
            scope_messageId: { scope: "materials", messageId: next.messageId },
          },
        }),
      ).toMatchObject({ traceparent: null });
    }
    const traced = encodeNotification("materials", {
      ...event,
      messageId: randomUUID(),
    });
    await transport.accept(traced, { traceparent: valid });
    expect(
      await transport.accept(traced, {
        traceparent: "00-33333333333333333333333333333333-4444444444444444-01",
      }),
    ).toBe("duplicate");
    expect(
      await database.prisma.notificationInbox.findUniqueOrThrow({
        where: {
          scope_messageId: { scope: "materials", messageId: traced.messageId },
        },
      }),
    ).toMatchObject({ traceparent: valid });
  } finally {
    await finishFixtureCleanup([
      () => telemetry.shutdown(),
      () => database.dispose(),
    ]);
  }
});

test(
  "untrusted AMQP metadata cannot poison a valid delivery or escape as baggage",
  async () => {
    const database = await createMigratedTestDatabase();
    const cleanup: (() => unknown)[] = [() => database.dispose()];
    const spans = new InMemorySpanExporter();
    const telemetry = createTechnicalTelemetry({
      enabled: true,
      service: "platform-notifications-worker",
      environment: "test",
      release: "wire-proof",
      sampleRatio: 1,
      exporters: {
        spans,
        metrics: new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE),
      },
    });
    cleanup.unshift(() => telemetry.shutdown());
    try {
      const broker = await startNotificationBroker({
        topology: localNotificationTopology("inside-test", 100),
      });
      cleanup.unshift(() => broker.stop());
      const publisher = await connectNotificationBroker({
        url: broker.urls.materials,
      });
      cleanup.unshift(() => publisher.close());
      const subscriber = await connectNotificationBroker({
        url: broker.urls.notifications,
      });
      cleanup.unshift(() => subscriber.close());
      const transport = assembleNotificationTransport(database.prisma, 10);
      const consumer = await telemetry.runJob(() =>
        consumeNotificationLane(subscriber, "materials", transport, 1),
      );
      cleanup.unshift(() => consumer.stop());
      const channel = await publisher.createConfirmChannel();
      cleanup.unshift(() => channel.close());
      const valid = "00-11111111111111111111111111111111-2222222222222222-01";
      const values = [
        undefined,
        valid,
        `${valid}opaque-private`,
        "x".repeat(4_096),
        123,
        [valid],
        Buffer.from(valid),
      ];
      for (const traceparent of values) {
        const envelope = encodeNotification("materials", {
          ...materialFixture,
          messageId: randomUUID(),
        });
        channel.publish(
          lanes.materials.exchange,
          lanes.materials.key,
          Buffer.from(envelope.payload),
          {
            persistent: true,
            mandatory: true,
            contentType: "application/json",
            messageId: envelope.messageId,
            type: envelope.version,
            headers: {
              ...(traceparent === undefined ? {} : { traceparent }),
              baggage: "private-baggage-sentinel",
              tracestate: "private-state-sentinel",
            },
          },
        );
        await channel.waitForConfirms();
        await eventually(async () => {
          const row = await database.prisma.notificationInbox.findUniqueOrThrow(
            {
              where: {
                scope_messageId: {
                  scope: "materials",
                  messageId: envelope.messageId,
                },
              },
            },
          );
          expect(row).toMatchObject({
            digest: envelope.digest,
            payload: envelope.payload,
            traceparent:
              traceparent === valid
                ? (expect.stringContaining(
                    "11111111111111111111111111111111",
                  ) as unknown)
                : null,
          });
        }, RECOVERY_FACT_BUDGET_MS);
      }
      expect(await database.prisma.notificationQuarantine.count()).toBe(0);
      await eventually(
        async () =>
          expect(
            await queueDepth(
              broker.admin,
              "inside-test",
              lanes.materials.queue,
            ),
          ).toBe(0),
        RECOVERY_FACT_BUDGET_MS,
      );
      await telemetry.flush();
      const evidence = JSON.stringify(
        spans.getFinishedSpans().map((span) => ({
          attributes: span.attributes,
          status: span.status,
          events: span.events,
          links: span.links,
          context: span.spanContext(),
        })),
      );
      expect(evidence).not.toContain("private-baggage-sentinel");
      expect(evidence).not.toContain("private-state-sentinel");
      expect(evidence).not.toContain("opaque-private");
    } finally {
      await finishFixtureCleanup(cleanup);
    }
  },
  PUBLICATION_RECOVERY_BUDGET_MS,
);

for (const mode of ["off", "export-failure"] as const) {
  test(
    `HTTP publication and audience remain available with telemetry ${mode}`,
    async () => {
      const database = await createMigratedTestDatabase();
      const cleanup: (() => unknown)[] = [() => database.dispose()];
      const wire: string[] = [];
      const warnings = vi
        .spyOn(console, "warn")
        .mockImplementation(() => undefined);
      cleanup.push(() => warnings.mockRestore());
      try {
        const collector = createServer((request, response) => {
          let body = "";
          request.setEncoding("utf8");
          request.on("data", (chunk: string) => {
            body += chunk;
          });
          request.on("end", () => {
            wire.push(body);
            response.writeHead(503, {
              "Retry-After": IMMEDIATE_RETRY_HTTP_DATE,
            });
            response.end("private-collector-error-sentinel");
          });
        });
        collector.listen(0, "127.0.0.1");
        cleanup.unshift(
          () =>
            new Promise<void>((resolve, reject) =>
              collector.close((error) => (error ? reject(error) : resolve())),
            ),
        );
        await once(collector, "listening");
        const address = collector.address();
        if (address === null || typeof address === "string")
          throw new Error("collector address unavailable");
        const endpoint = `http://127.0.0.1:${address.port}`;
        vi.stubEnv("INSIDE_OTEL_ENABLED", mode === "off" ? undefined : "true");
        vi.stubEnv("INSIDE_OTEL_ENDPOINT", endpoint);
        cleanup.push(() => vi.unstubAllEnvs());
        let jwksRequests = 0;
        const identity = await startTestIdentityIssuer({
          issuer: "https://identity.example.test/oidc",
          audience: "https://api.example.test",
          onJwksRequest: () => {
            jwksRequests++;
          },
        });
        cleanup.unshift(() => identity.close());
        const broker = await startNotificationBroker({
          topology: localNotificationTopology("inside-test", 100),
        });
        cleanup.unshift(() => broker.stop());
        const app = await createApiApplication(
          parsePlatformConfig({
            NODE_ENV: "test",
            DATABASE_URL: database.url,
            LOGTO_ISSUER: identity.issuer,
            LOGTO_AUDIENCE: identity.audience,
            LOGTO_JWKS_URL: identity.jwksUrl,
            NOTIFICATIONS_PLATFORM_ORIGIN: "https://inside.example.test",
            NOTIFICATIONS_TELEGRAM_SECRET:
              "synthetic-notification-secret-00000",
          }),
          { logger: false },
        );
        cleanup.unshift(() => app.close());
        await app.listen(0, "127.0.0.1");
        const owner = randomUUID();
        const topicId = randomUUID();
        await database.prisma.account.create({
          data: {
            id: owner,
            logtoIssuer: identity.issuer,
            logtoSubject: owner,
            createdAt: new Date("2026-01-01T00:00:00Z"),
          },
        });
        await database.prisma.accountPermission.create({
          data: { accountId: owner, permission: "materials:manage" },
        });
        await database.prisma.topic.create({
          data: { id: topicId, name: "Synthetic", slug: "synthetic" },
        });
        const metadata = {
          title: "private-off-title-sentinel",
          summary: "private-off-summary-sentinel",
          access: "free" as const,
          topicId,
          formatId: "guide",
          tagIds: [],
          difficulty: null,
          outcomes: [],
          seriesIds: [],
        };
        const body = representativeDocument("private-off-body-sentinel");
        const materials = assembleMaterials({
          prisma: database.prisma,
          authorPolicy: { canManage: (id) => id === owner },
        });
        const draft = await materials.authoring.createDraft({
          actor: owner,
          idempotencyKey: randomUUID(),
          metadata,
          body,
        });
        if (!draft.ok) throw new Error(draft.error.code);
        const token = await identity.sign(owner);
        const response = await fetch(
          `${await app.getUrl()}/authoring/materials/${draft.value.materialId}`,
          {
            method: "PUT",
            headers: {
              authorization: `Bearer ${token}`,
              "content-type": "application/json",
              "idempotency-key": randomUUID(),
            },
            body: JSON.stringify({
              expectedContentVersion: 1,
              publicationState: "published",
              metadata,
              body,
            }),
          },
        );
        expect(response.status).toBe(200);
        expect(jwksRequests).toBe(1);
        const source =
          await database.prisma.materialNotificationOutbox.findFirstOrThrow();
        expect(source.traceparent).toEqual(
          mode === "off" ? null : (expect.any(String) as unknown),
        );
        const worker = technicalTelemetryFromEnvironment({
          environment:
            mode === "off"
              ? {}
              : { INSIDE_OTEL_ENABLED: "true", INSIDE_OTEL_ENDPOINT: endpoint },
          service: "platform-notifications-worker",
          mode: "test",
          identity: {
            release: "failure-proof",
            sourceSha: "0000000000000000000000000000000000000000",
          },
        });
        cleanup.unshift(() => worker.shutdown());
        const publisher = await connectNotificationBroker({
          url: broker.urls.materials,
        });
        cleanup.unshift(() => publisher.close());
        const subscriber = await connectNotificationBroker({
          url: broker.urls.notifications,
        });
        cleanup.unshift(() => subscriber.close());
        const notifications = app.get(Notifications);
        const consumer = await worker.runJob(() =>
          consumeNotificationLane(
            subscriber,
            "materials",
            notifications.transport,
            1,
          ),
        );
        cleanup.unshift(() => consumer.stop());
        await worker.runJob(() =>
          assembleMaterialsNotificationOutbox(database.prisma).relay(
            "materials",
            (envelope, carrier) =>
              publishNotification(publisher, envelope, carrier),
          ),
        );
        await eventually(
          async () =>
            expect(await database.prisma.notificationInbox.count()).toBe(1),
          RECOVERY_FACT_BUDGET_MS,
        );
        await worker.runJob(() => notifications.sweep());
        expect(await database.prisma.materialNotificationOutbox.count()).toBe(
          1,
        );
        expect(
          await database.prisma.materialNotificationOutbox.findFirstOrThrow(),
        ).toMatchObject({
          ...source,
          publishedAt: expect.any(Date) as unknown,
          attempts: 0,
          lastFailure: null,
        });
        expect(await database.prisma.notificationInbox.count()).toBe(1);
        const inbox =
          await database.prisma.notificationInbox.findFirstOrThrow();
        expect(inbox).toMatchObject({
          scope: source.scope,
          messageId: source.messageId,
          completedAt: expect.any(Date) as unknown,
          digest: source.digest,
          payload: source.payload,
          traceparent: mode === "off" ? null : (expect.any(String) as unknown),
        });
        await worker.flush();
        await app.close();
        if (mode === "off") expect(wire).toEqual([]);
        else {
          // A retry resends the same OTLP payload, not another business operation.
          const tracePayloadAttempts = new Map<string, number>();
          const logicalSpans = new Map<string, z.infer<typeof spanSchema>>();
          for (const payload of wire) {
            const spans = exportedSpans([payload]);
            if (spans.length === 0) continue;
            tracePayloadAttempts.set(
              payload,
              (tracePayloadAttempts.get(payload) ?? 0) + 1,
            );
            const identities = spans.map(
              (span) => `${span.traceId}/${span.spanId}`,
            );
            expect(new Set(identities).size).toBe(spans.length);
            for (const span of spans) {
              const identity = `${span.traceId}/${span.spanId}`;
              const previous = logicalSpans.get(identity);
              if (previous !== undefined) expect(span).toEqual(previous);
              logicalSpans.set(identity, span);
            }
          }
          // The fixed Retry-After must exercise the pinned transport, not merely allow duplicates.
          expect(tracePayloadAttempts.size).toBeGreaterThan(0);
          for (const attempts of tracePayloadAttempts.values())
            expect(attempts).toBeGreaterThan(1);
          const allObserved = [...logicalSpans.values()];
          const materialNames = [
            "PUT /authoring/materials/:materialId",
            "audience materials",
            "publish materials",
            "receive materials",
          ];
          const observed = allObserved.filter((span) =>
            materialNames.includes(span.name),
          );
          expect(observed.map((span) => span.name).sort()).toEqual(
            materialNames,
          );
          // The cold real JWKS fetch is one explicit dependency, not SQL or another publication.
          const jwks = allObserved.filter((span) => span.name === "logto jwks");
          expect(jwks).toHaveLength(1);
          for (const span of jwks) {
            const attributes = z
              .array(
                z.strictObject({
                  key: z.enum([
                    "dependency.name",
                    "dependency.operation",
                    "dependency.outcome",
                    "http.request.method",
                    "http.response.status_code",
                  ]),
                  value: z.union([
                    z.strictObject({ stringValue: z.string() }),
                    z.strictObject({
                      intValue: z.union([z.literal(200), z.literal("200")]),
                    }),
                  ]),
                }),
              )
              .parse(span["attributes"]);
            expect(attributes).toHaveLength(5);
            expect(
              new Set(attributes.map((attribute) => attribute.key)).size,
            ).toBe(5);
            expect(
              Object.fromEntries(
                attributes.map((attribute) => [
                  attribute.key,
                  "intValue" in attribute.value
                    ? Number(attribute.value.intValue)
                    : attribute.value.stringValue,
                ]),
              ),
            ).toEqual({
              "dependency.name": "logto",
              "dependency.operation": "jwks",
              "dependency.outcome": "completed",
              "http.request.method": "GET",
              "http.response.status_code": 200,
            });
            expect(span["kind"]).toBe(3);
            expect(span["events"] ?? []).toEqual([]);
            expect(span["links"] ?? []).toEqual([]);
          }
          const metricSchema = z.object({
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
                                    z.looseObject({
                                      key: z.string(),
                                      value: z.looseObject({
                                        stringValue: z.string().optional(),
                                      }),
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
          const jwksCounts: number[] = [];
          for (const payload of wire) {
            const metrics =
              metricSchema
                .parse(JSON.parse(payload))
                .resourceMetrics?.flatMap((resource) =>
                  resource.scopeMetrics.flatMap((scope) => scope.metrics),
                ) ?? [];
            for (const metric of metrics) {
              if (metric.name !== "inside.dependency.operations") continue;
              for (const point of metric.sum?.dataPoints ?? []) {
                if (
                  !point.attributes.some(
                    (attribute) =>
                      attribute.key === "dependency" &&
                      attribute.value.stringValue === "logto",
                  )
                )
                  continue;
                const attributes = z
                  .array(
                    z.strictObject({
                      key: z.enum(["dependency", "operation", "outcome"]),
                      value: z.strictObject({ stringValue: z.string() }),
                    }),
                  )
                  .parse(point.attributes);
                expect(attributes).toHaveLength(3);
                expect(
                  new Set(attributes.map((attribute) => attribute.key)).size,
                ).toBe(3);
                expect(
                  Object.fromEntries(
                    attributes.map((attribute) => [
                      attribute.key,
                      attribute.value.stringValue,
                    ]),
                  ),
                ).toEqual({
                  dependency: "logto",
                  operation: "jwks",
                  outcome: "completed",
                });
                expect(point.asDouble).toBe(1);
                jwksCounts.push(point.asDouble);
              }
            }
          }
          // Repeated cumulative exports retain one completed request, not another provider attempt.
          expect(jwksCounts.length).toBeGreaterThan(0);
          // SQL observations are additional operations, not replacement material spans or ignored noise.
          // Unscoped worker reads may be roots; every exported child must retain a real exported parent.
          const sql = allObserved.filter(
            (span) =>
              !materialNames.includes(span.name) && span.name !== "logto jwks",
          );
          expect(sql.length).toBeGreaterThan(0);
          const sqlOperations = new Set<string>();
          for (const span of sql) {
            const name = z
              .enum([
                "postgresql acquire",
                "postgresql query",
                "postgresql material-slug-lock",
              ])
              .parse(span.name);
            const attributes = z
              .array(
                z.strictObject({
                  key: z.enum([
                    "dependency.name",
                    "dependency.operation",
                    "dependency.outcome",
                  ]),
                  value: z.strictObject({ stringValue: z.string() }),
                }),
              )
              .parse(span["attributes"]);
            expect(attributes).toHaveLength(3);
            const values = Object.fromEntries(
              attributes.map((attribute) => [
                attribute.key,
                attribute.value.stringValue,
              ]),
            );
            const operation = name.slice("postgresql ".length);
            const outcome = z
              .enum(["completed", "failed"])
              .parse(values["dependency.outcome"]);
            expect(values).toEqual({
              "dependency.name": "postgresql",
              "dependency.operation": operation,
              "dependency.outcome": outcome,
            });
            expect(span["kind"]).toBe(
              operation === "material-slug-lock" ? 1 : 3,
            );
            expect(span.traceId).toMatch(/^[0-9a-f]{32}$/u);
            expect(span.spanId).toMatch(/^[0-9a-f]{16}$/u);
            expect(span["events"] ?? []).toEqual([]);
            expect(span["links"] ?? []).toEqual([]);
            if (span.parentSpanId !== undefined) {
              expect(
                logicalSpans.has(`${span.traceId}/${span.parentSpanId}`),
              ).toBe(true);
              expect(span.parentSpanId).not.toBe(span.spanId);
            }
            sqlOperations.add(operation);
          }
          expect(sqlOperations.has("acquire")).toBe(true);
          expect(sqlOperations.has("query")).toBe(true);
          const publication = observed.find(
            (span) => span.name === "PUT /authoring/materials/:materialId",
          );
          for (const span of jwks) {
            expect(span.traceId).toBe(publication?.traceId);
            expect(span.parentSpanId).toBe(publication?.spanId);
            expect(span.spanId).toMatch(/^[0-9a-f]{16}$/u);
            expect(span.spanId).not.toBe(publication?.spanId);
          }
          const expansion = observed.find(
            (span) => span.name === "audience materials",
          );
          for (const parent of [publication, expansion]) {
            expect(
              sql.some(
                (span) =>
                  span.traceId === parent?.traceId &&
                  span.parentSpanId === parent.spanId,
              ),
            ).toBe(true);
          }
          expect(
            observed.every(
              (span) => span.traceId === source.traceparent?.split("-")[1],
            ),
          ).toBe(true);
          const publish = observed.find(
            (span) => span.name === "publish materials",
          );
          const receive = observed.find(
            (span) => span.name === "receive materials",
          );
          const audience = observed.find(
            (span) => span.name === "audience materials",
          );
          expect(publish?.parentSpanId).toBe(source.traceparent?.split("-")[2]);
          expect(receive?.parentSpanId).toBe(publish?.spanId);
          expect(inbox.traceparent?.split("-")[2]).toBe(receive?.spanId);
          expect(audience?.parentSpanId).toBe(receive?.spanId);
          // OTLP protobuf kinds are one-based, unlike the OpenTelemetry API enum.
          for (const [span, operation, kind] of [
            [publish, "publish", 4],
            [receive, "receive", 5],
            [audience, "audience", 1],
          ] as const) {
            expect(span).toMatchObject({ kind });
            expect(span?.["attributes"]).toEqual([
              { key: "messaging.system", value: { stringValue: "rabbitmq" } },
              {
                key: "messaging.destination.name",
                value: { stringValue: "inside.events.materials.v1" },
              },
              {
                key: "messaging.operation.name",
                value: { stringValue: operation },
              },
            ]);
          }
          expect(worker.diagnostics().failedTraceExports).toBeGreaterThan(0);
          expect(worker.diagnostics().failedMetricExports).toBeGreaterThan(0);
          expect(
            warnings.mock.calls.some(([line]) =>
              String(line).includes("telemetry_export_failed"),
            ),
          ).toBe(true);
        }
        const evidence = JSON.stringify({
          wire,
          warnings: warnings.mock.calls,
        });
        for (const sentinel of [
          "private-collector-error-sentinel",
          "private-off-title-sentinel",
          "private-off-summary-sentinel",
          "private-off-body-sentinel",
          owner,
          token,
        ])
          expect(evidence).not.toContain(sentinel);
      } finally {
        await finishFixtureCleanup(cleanup);
      }
    },
    PUBLICATION_RECOVERY_BUDGET_MS,
  );
}

test("nullable carrier upgrade rolls back on a bounded lock refusal and retains full-registry legacy writers", async () => {
  const database = await createTestDatabase();
  const admin = new Pool({ connectionString: database.url, max: 1 });
  try {
    const legacyRegistry = platformMigrations.slice(0, -2);
    await runMigrationsToLatest(database.url, legacyRegistry);
    const legacy = encodeNotification("materials", {
      ...materialFixture,
      messageId: randomUUID(),
    });
    const row = {
      scope: "materials",
      messageId: legacy.messageId,
      lane: "materials",
      payload: legacy.payload,
      digest: legacy.digest,
    };
    // The old writer's field set predates both nullable columns.
    await database.prisma.materialNotificationOutbox.createMany({ data: row });
    await database.prisma.notificationInbox.createMany({ data: row });
    await admin.query("begin");
    await admin.query(
      "lock table materials.notification_outbox in access exclusive mode",
    );
    try {
      await expect(
        runMigrationsToLatest(database.url, platformMigrations),
      ).rejects.toThrow("lock timeout");
    } finally {
      await admin.query("rollback");
    }
    expect(
      (await verifyMigrationState(database.url, legacyRegistry))
        .appliedMigrations,
    ).toEqual(legacyRegistry.map((migration) => migration.name));
    expect(
      await runMigrationsToLatest(database.url, platformMigrations),
    ).toEqual({
      appliedMigrations: [
        "0109_materials_notification_trace_context",
        "0110_notifications_notification_trace_context",
      ],
    });
    const migration = await migrateRuntimeDatabase(database.url);
    const identity = runtimeDatabaseSchemaIdentity(
      platformMigrations,
      migration.jobSchemaVersion,
    );
    await expect(
      verifyRuntimeDatabaseSchema(database.url, identity),
    ).resolves.toMatchObject({ identity });
    await expect(
      verifyMigrationState(database.url, legacyRegistry),
    ).rejects.toThrow("not an exact registry prefix");
    // Compatible rollback keeps the FULL registry; legacy payload-only callers still work.
    const published: unknown[][] = [];
    await assembleMaterialsNotificationOutbox(database.prisma).relay(
      "materials",
      (...args) => {
        published.push(args);
        return Promise.resolve();
      },
    );
    expect(published).toEqual([[legacy, undefined]]);
    expect(
      await assembleNotificationTransport(database.prisma, 10).accept(legacy, {
        traceparent: "00-11111111111111111111111111111111-2222222222222222-01",
      }),
    ).toBe("duplicate");
    expect(
      await database.prisma.materialNotificationOutbox.findFirstOrThrow(),
    ).toMatchObject({ traceparent: null, digest: legacy.digest });
    expect(
      await database.prisma.notificationInbox.findFirstOrThrow(),
    ).toMatchObject({ traceparent: null, digest: legacy.digest });
    const next = encodeNotification("materials", {
      ...materialFixture,
      messageId: randomUUID(),
    });
    await database.prisma.materialNotificationOutbox.createMany({
      data: {
        ...row,
        messageId: next.messageId,
        payload: next.payload,
        digest: next.digest,
      },
    });
    expect(
      await database.prisma.materialNotificationOutbox.findUniqueOrThrow({
        where: {
          scope_messageId: { scope: "materials", messageId: next.messageId },
        },
      }),
    ).toMatchObject({ traceparent: null });
  } finally {
    await finishFixtureCleanup([() => admin.end(), () => database.dispose()]);
  }
});

// Stops a broken observer before Vitest's outer deadline; exceeds the native command's kill budget.
const BROKER_ADMIN_OBSERVATION_BUDGET_MS = 15_000;
test("broker admin terminates a hung Erlang command and preserves broker availability", async () => {
  const broker = await startNotificationBroker({
    topology: localNotificationTopology("inside-test", 100),
  });
  let pending: Promise<string> | undefined;
  try {
    pending = broker.admin(["eval", "timer:sleep(infinity)."]);
    await expect(
      boundedProcessFact(pending, BROKER_ADMIN_OBSERVATION_BUDGET_MS),
    ).rejects.toThrow("notification_broker_admin_failed");
    expect((await broker.admin(["eval", "1 + 1."])).trim()).toBe("2");
  } finally {
    await broker.stop();
    // Container shutdown also ends the intentionally hung command on the RED implementation.
    if (pending !== undefined) await Promise.allSettled([pending]);
  }
});
