import { refreshDeliveries } from "../../src/modules/notifications/features/expand-audience/refresh-deliveries.js";
import { Pool } from "pg";
import { Prisma } from "../../src/infrastructure/prisma/index.js";
import { platformMigrations } from "../../src/migrations/index.js";
import {
  runMigrationsToLatest,
  verifyMigrationState,
} from "../../src/infrastructure/postgres/migrate-to-latest.js";
import { createTestDatabase } from "./setup/test-database.js";
import { encodeNotification } from "../../src/infrastructure/notification-transport/wire.js";
import { dispatchEmail } from "../../src/modules/notifications/features/dispatch-email/dispatch-email.js";
import { stageDeliveryCommand } from "../../src/modules/notifications/infrastructure/stage-delivery-command.js";
import { renderNotification } from "../../src/modules/notifications/domain/templates.js";
import type { NotificationDependencies } from "../../src/modules/notifications/features/expand-audience/expand-audience.js";
import type {
  NotificationSource,
  SendNotificationEmail,
} from "../../src/modules/notifications/ports/notification-sources.js";
import type {
  Binding,
  DeliveryCommand,
  NotificationEvent,
} from "../../src/modules/notifications/domain/notification-wire.js";
import { randomUUID } from "node:crypto";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import {
  AggregationTemporality,
  InMemoryMetricExporter,
} from "@opentelemetry/sdk-metrics";
import { expect, test } from "vitest";
import fixtures from "../../../../docs/contracts/notifications-v1/fixtures.json" with { type: "json" };
import { createMigratedTestDatabase } from "./setup/test-database.js";
import { finishFixtureCleanup } from "./setup/queue-telemetry-process.js";
import { acceptEmailCommand } from "../../src/modules/notifications/features/dispatch-email/dispatch-email.js";
import {
  deliverySchema,
  resultSchema,
} from "../../src/modules/notifications/domain/notification-wire.js";
import { createTechnicalTelemetry } from "../../src/infrastructure/observability/technical-telemetry.js";
import { assembleNotificationTransport } from "../../src/modules/notifications/index.js";

const commandFixture = fixtures.find(
  (fixture) => fixture.valid && fixture.definition === "emailDelivery",
)?.value;
// This fixture owns the database immediately, including a later SDK-construction failure.
async function createEmailContextFixture() {
  const database = await createMigratedTestDatabase();
  try {
    const spans = new InMemorySpanExporter();
    const telemetry = createTechnicalTelemetry({
      enabled: true,
      service: "platform-notifications-worker",
      environment: "test",
      release: "proof",
      sampleRatio: 1,
      exporters: {
        spans,
        metrics: new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE),
      },
    });
    return { database, telemetry, spans };
  } catch (error) {
    await database.dispose();
    throw error;
  }
}
const original = "00-11111111111111111111111111111111-2222222222222222-01";
const duplicate = "00-33333333333333333333333333333333-4444444444444444-01";

for (const initial of [original, null] as const) {
  test(`email command replay retains ${initial === null ? "legacy NULL" : "the original carrier"} when a result outbox is recreated`, async () => {
    const { database, telemetry } = await createEmailContextFixture();
    try {
      const command = deliverySchema.parse({
        ...commandFixture,
        operationId: randomUUID(),
        deliveryRef: randomUUID(),
      });
      const now = () => new Date(command.issuedAt);
      expect(
        await acceptEmailCommand(
          database.prisma,
          command,
          "emailMaterial",
          now,
          { traceparent: initial },
        ),
      ).toBe("accepted");
      const first =
        await database.prisma.notificationEmailInbox.findUniqueOrThrow({
          where: { operationId: command.operationId },
        });
      const outbox =
        await database.prisma.notificationOutbox.findFirstOrThrow();
      expect(first.traceparent).toBe(initial);
      expect(outbox.traceparent).toBe(initial);
      const unrelated = telemetry.startHttp({
        method: "GET",
        route: "/unrelated",
      });
      await database.prisma.notificationOutbox.deleteMany();
      expect(
        await unrelated.run(() =>
          acceptEmailCommand(database.prisma, command, "emailMaterial", now, {
            traceparent: duplicate,
          }),
        ),
      ).toBe("duplicate");
      unrelated.finish(200, 1);
      expect(
        await database.prisma.notificationEmailInbox.findUniqueOrThrow({
          where: { operationId: command.operationId },
        }),
      ).toEqual(first);
      expect(
        await database.prisma.notificationOutbox.findFirstOrThrow(),
      ).toMatchObject({
        messageId: outbox.messageId,
        payload: outbox.payload,
        digest: outbox.digest,
        traceparent: initial,
      });
      const published: unknown[] = [];
      await telemetry.runJob(() =>
        assembleNotificationTransport(database.prisma, 10).outbox.relay(
          "emailResult",
          (envelope, metadata) => {
            published.push({ envelope, metadata });
            return Promise.resolve();
          },
        ),
      );
      expect(published).toHaveLength(1);
      expect(published[0]).toMatchObject({
        envelope: { payload: outbox.payload, digest: outbox.digest },
        metadata:
          initial === null
            ? undefined
            : {
                traceparent: expect.stringContaining(
                  "11111111111111111111111111111111",
                ) as unknown,
              },
      });
      // A corrupt mutable replay pointer keeps the business payload but cannot borrow this command's origin.
      for (const patch of [
        { operationId: randomUUID() },
        { deliveryRef: randomUUID() },
        { commandRevision: 2 },
        { payloadDigest: "f".repeat(64) },
        {
          state: "unknown",
          attemptRef: randomUUID(),
          reason: "interrupted_attempt",
        },
      ]) {
        const corrupted = resultSchema.parse({
          ...JSON.parse(outbox.payload),
          ...patch,
        });
        await database.prisma.notificationEmailEffect.update({
          where: { operationId: command.operationId },
          data: { resultPayload: JSON.stringify(corrupted) },
        });
        await database.prisma.notificationOutbox.delete({
          where: {
            scope_messageId: { scope: "email", messageId: corrupted.messageId },
          },
        });
        expect(
          await telemetry.runJob(() =>
            acceptEmailCommand(database.prisma, command, "emailMaterial", now, {
              traceparent: duplicate,
            }),
          ),
        ).toBe("duplicate");
        expect(
          await database.prisma.notificationOutbox.findUniqueOrThrow({
            where: {
              scope_messageId: {
                scope: "email",
                messageId: corrupted.messageId,
              },
            },
          }),
        ).toMatchObject({
          traceparent: null,
          payload: encodeNotification("emailResult", corrupted).payload,
        });
      }
    } finally {
      await finishFixtureCleanup([
        () => telemetry.shutdown(),
        () => database.dispose(),
      ]);
    }
  });
}

test("email admission rejects malformed metadata without changing the canonical command or duplicate authority", async () => {
  const database = await createMigratedTestDatabase();
  try {
    const command = deliverySchema.parse({
      ...commandFixture,
      operationId: randomUUID(),
      deliveryRef: randomUUID(),
    });
    const now = () => new Date(command.issuedAt);
    expect(
      await acceptEmailCommand(database.prisma, command, "emailMaterial", now, {
        traceparent: { toString: () => original },
      }),
    ).toBe("accepted");
    expect(
      await acceptEmailCommand(database.prisma, command, "emailMaterial", now, {
        traceparent: original,
      }),
    ).toBe("duplicate");
    const inbox =
      await database.prisma.notificationEmailInbox.findUniqueOrThrow({
        where: { operationId: command.operationId },
      });
    expect(inbox.traceparent).toBeNull();
    expect(JSON.parse(inbox.payload)).toEqual(command);
    const result = resultSchema.parse(
      JSON.parse(
        (await database.prisma.notificationOutbox.findFirstOrThrow()).payload,
      ),
    );
    expect(result.payloadDigest).toBe(inbox.digest.slice("sha256:".length));
    expect(result.state).toBe("accepted");
    expect(await database.prisma.notificationEmailAttempt.count()).toBe(0);
  } finally {
    await database.dispose();
  }
});

// External source/contact ports are synthetic; persistence, permits, transactions and dispatch are real.
// This test does not claim the HTTP/Rabbit/SMTP end-to-end acceptance.
test("email retries retain the owning attempt context while separate durable rows never share a dispatch scope", async () => {
  const { database, telemetry, spans } = await createEmailContextFixture();
  try {
    let instant = new Date("2026-09-08T12:00:00Z");
    const now = () => instant;
    const sources = new Map<string, NotificationSource>();
    const bindings = new Map<string, Binding>();
    const deps: NotificationDependencies = {
      prisma: database.prisma,
      now,
      origin: "https://inside.example.test",
      sources: {
        resolve: (event) =>
          Promise.resolve(
            sources.get(event.sourceRef) ?? { status: "unavailable" },
          ),
        canRead: () => Promise.resolve("allowed"),
      },
      recipients: {
        exists: () => Promise.resolve(true),
        enumerate: () => Promise.resolve([]),
        binding: (account) => Promise.resolve(bindings.get(account) ?? null),
        email: () => Promise.resolve("private-recipient@example.test"),
      },
    };
    const commands: DeliveryCommand[] = [];
    for (const parent of [original, duplicate]) {
      const actor = randomUUID();
      const event: NotificationEvent = {
        contractVersion: "inside.notification-event.v1",
        messageId: randomUUID(),
        occurrenceRef: randomUUID(),
        sourceRef: randomUUID(),
        sourceRevision: 1,
        eventType: "billing.notice-ready",
        accountRef: actor,
        kind: "payment_succeeded",
        occurredAt: now().toISOString(),
        notAfter: "2026-09-08T13:00:00Z",
      };
      const source: NotificationSource = {
        status: "current",
        event,
        content: { category: "subscription", kind: "payment_succeeded" },
        accountId: actor,
        title: "private-title-sentinel",
        readerPath: "/private-reader-sentinel",
        amountMinor: 100,
      };
      const binding: Binding = {
        channel: "email",
        accountRef: actor,
        contactRef: randomUUID(),
        contactRevision: 1,
      };
      sources.set(event.sourceRef, source);
      bindings.set(actor, binding);
      const template = renderNotification(
        source,
        "https://inside.example.test",
      );
      const id = randomUUID();
      const delivery = randomUUID();
      await database.prisma.notification.create({
        data: {
          id,
          kind: event.eventType,
          occurrenceRef: event.occurrenceRef,
          accountId: actor,
          eventPayload: JSON.stringify(event),
          sourceRevision: 1,
          createdAt: now(),
        },
      });
      await database.prisma.notificationDelivery.create({
        data: {
          id: delivery,
          notificationId: id,
          channel: "email",
          updatedAt: now(),
        },
      });
      const command = deliverySchema.parse({
        contractVersion: "inside.notification-delivery.v1",
        operationId: randomUUID(),
        notificationRef: id,
        deliveryRef: delivery,
        commandRevision: 1,
        sourceEventId: event.messageId,
        content: source.content,
        ...template,
        binding,
        issuedAt: now().toISOString(),
        notAfter: "2026-09-08T12:10:00Z",
      });
      await database.prisma.$transaction((transaction) =>
        stageDeliveryCommand(transaction, command, now(), parent),
      );
      await acceptEmailCommand(
        database.prisma,
        command,
        "emailSubscription",
        now,
        { traceparent: parent },
      );
      commands.push(command);
    }
    let sends = 0;
    const send: SendNotificationEmail = async (message) => {
      sends++;
      const effect =
        await database.prisma.notificationEmailEffect.findUniqueOrThrow({
          where: { operationId: message.operationId },
        });
      expect(effect.state).toBe("unknown");
      expect(
        await database.prisma.notificationEmailAttempt.findUniqueOrThrow({
          where: { id: effect.attemptRef ?? "missing" },
        }),
      ).toMatchObject({
        operationId: message.operationId,
        state: "unknown",
        completedAt: null,
      });
      return { state: "not_sent", retryAfterMs: 5_000 };
    };
    await telemetry.runJob(() => dispatchEmail(deps, send, "subscription"));
    await telemetry.runJob(() => dispatchEmail(deps, send, "subscription"));
    expect(sends).toBe(2);
    const attempts = await database.prisma.notificationEmailAttempt.findMany();
    expect(attempts).toHaveLength(2);
    expect(
      new Set(attempts.map((attempt) => attempt.traceparent?.split("-")[1])),
    ).toEqual(new Set([original.split("-")[1], duplicate.split("-")[1]]));
    for (const command of commands) {
      const attempt = attempts.find(
        (candidate) => candidate.operationId === command.operationId,
      );
      const effect =
        await database.prisma.notificationEmailEffect.findUniqueOrThrow({
          where: { operationId: command.operationId },
        });
      const result = resultSchema.parse(
        JSON.parse(effect.resultPayload ?? "null"),
      );
      expect(result.state).toBe("retrying");
      expect(
        await database.prisma.notificationOutbox.findUniqueOrThrow({
          where: {
            scope_messageId: { scope: "email", messageId: result.messageId },
          },
        }),
      ).toMatchObject({ traceparent: attempt?.traceparent });
    }
    // An unavailable authority adds a result revision, not another send or attempt. It retains the previous not_sent attempt's context.
    for (const key of sources.keys())
      sources.set(key, { status: "unavailable" });
    instant = new Date("2026-09-08T12:00:05Z");
    await telemetry.runJob(() => dispatchEmail(deps, send, "subscription"));
    expect(sends).toBe(2);
    expect(await database.prisma.notificationEmailAttempt.count()).toBe(2);
    const changed =
      await database.prisma.notificationEmailEffect.findFirstOrThrow({
        where: { retries: 2 },
      });
    const result = resultSchema.parse(
      JSON.parse(changed.resultPayload ?? "null"),
    );
    const owningAttempt = attempts.find(
      (attempt) => attempt.id === result.attemptRef,
    );
    expect(result.reason).toBe("source_unavailable");
    expect(
      await database.prisma.notificationOutbox.findUniqueOrThrow({
        where: {
          scope_messageId: { scope: "email", messageId: result.messageId },
        },
      }),
    ).toMatchObject({ traceparent: owningAttempt?.traceparent });
    await database.prisma.notificationOutbox.delete({
      where: {
        scope_messageId: { scope: "email", messageId: result.messageId },
      },
    });
    const command = commands.find(
      (candidate) => candidate.operationId === result.operationId,
    );
    if (command === undefined) throw new Error("owning command absent");
    await telemetry.runJob(() =>
      acceptEmailCommand(database.prisma, command, "emailSubscription", now, {
        traceparent: duplicate,
      }),
    );
    expect(
      await database.prisma.notificationOutbox.findUniqueOrThrow({
        where: {
          scope_messageId: { scope: "email", messageId: result.messageId },
        },
      }),
    ).toMatchObject({ traceparent: owningAttempt?.traceparent });
    // A stale/foreign attempt reference cannot lend its trace even if the mutable result pointer is corrupt.
    if (owningAttempt === undefined) throw new Error("owning attempt absent");
    await database.prisma.notificationEmailAttempt.update({
      where: { id: owningAttempt.id },
      data: { operationId: randomUUID() },
    });
    await database.prisma.notificationOutbox.delete({
      where: {
        scope_messageId: { scope: "email", messageId: result.messageId },
      },
    });
    await telemetry.runJob(() =>
      acceptEmailCommand(database.prisma, command, "emailSubscription", now, {
        traceparent: duplicate,
      }),
    );
    expect(
      await database.prisma.notificationOutbox.findUniqueOrThrow({
        where: {
          scope_messageId: { scope: "email", messageId: result.messageId },
        },
      }),
    ).toMatchObject({ traceparent: null });
    const otherAttempt = attempts.find(
      (attempt) => attempt.id !== owningAttempt.id,
    );
    if (otherAttempt === undefined) throw new Error("other attempt absent");
    await database.prisma.notificationEmailAttempt.update({
      where: { id: owningAttempt.id },
      data: {
        operationId: result.operationId,
        deliveryId: otherAttempt.deliveryId,
      },
    });
    await database.prisma.notificationOutbox.delete({
      where: {
        scope_messageId: { scope: "email", messageId: result.messageId },
      },
    });
    await telemetry.runJob(() =>
      acceptEmailCommand(database.prisma, command, "emailSubscription", now, {
        traceparent: duplicate,
      }),
    );
    expect(
      await database.prisma.notificationOutbox.findUniqueOrThrow({
        where: {
          scope_messageId: { scope: "email", messageId: result.messageId },
        },
      }),
    ).toMatchObject({ traceparent: null });
    await telemetry.flush();
    const dispatches = spans
      .getFinishedSpans()
      .filter((span) => span.name === "dispatch emailSubscription");
    expect(dispatches).toHaveLength(3);
    expect(
      dispatches.every((span) =>
        ["2222222222222222", "4444444444444444"].includes(
          span.parentSpanContext?.spanId ?? "",
        ),
      ),
    ).toBe(true);
    expect(
      spans.getFinishedSpans().some((span) => span.name === "smtp send"),
    ).toBe(false);
    expect(
      JSON.stringify(spans.getFinishedSpans().map((span) => span.attributes)),
    ).not.toContain("private-");
  } finally {
    await finishFixtureCleanup([
      () => telemetry.shutdown(),
      () => database.dispose(),
    ]);
  }
});

test("email carrier migration rolls back all four columns on a bounded lock refusal and preserves old writers", async () => {
  const database = await createTestDatabase();
  const admin = new Pool({ connectionString: database.url, max: 1 });
  try {
    const before = platformMigrations.slice(0, -1);
    await runMigrationsToLatest(database.url, before);
    const command = deliverySchema.parse({
      ...commandFixture,
      operationId: randomUUID(),
      deliveryRef: randomUUID(),
    });
    const envelope = encodeNotification("emailMaterial", command);
    await database.prisma.notificationEmailInbox.createMany({
      data: {
        operationId: command.operationId,
        deliveryId: command.deliveryRef,
        commandRevision: command.commandRevision,
        payload: envelope.payload,
        digest: envelope.digest,
        receivedAt: new Date(command.issuedAt),
      },
    });
    await admin.query("begin");
    await admin.query(
      "lock table notifications.email_attempts in access exclusive mode",
    );
    try {
      await expect(
        runMigrationsToLatest(database.url, platformMigrations),
      ).rejects.toThrow("lock timeout");
    } finally {
      await admin.query("rollback");
    }
    expect(
      (await verifyMigrationState(database.url, before)).appliedMigrations,
    ).toEqual(before.map((migration) => migration.name));
    expect(
      await database.prisma.$queryRaw(
        Prisma.sql`select table_name from information_schema.columns where table_schema = 'notifications' and column_name = 'traceparent' and table_name in ('notification_outbox', 'commands', 'email_inbox', 'email_attempts')`,
      ),
    ).toEqual([]);
    expect(
      await runMigrationsToLatest(database.url, platformMigrations),
    ).toEqual({
      appliedMigrations: ["0111_notifications_email_trace_context"],
    });
    expect(
      await acceptEmailCommand(
        database.prisma,
        command,
        "emailMaterial",
        () => new Date(command.issuedAt),
        { traceparent: original },
      ),
    ).toBe("duplicate");
    expect(
      await database.prisma.notificationEmailInbox.findUniqueOrThrow({
        where: { operationId: command.operationId },
      }),
    ).toMatchObject({
      traceparent: null,
      payload: envelope.payload,
      digest: envelope.digest,
    });
  } finally {
    await finishFixtureCleanup([() => admin.end(), () => database.dispose()]);
  }
});

for (const mode of [
  "same-source-null",
  "changed-source",
  "changed-source-gap",
] as const) {
  test(`email command refresh preserves the immutable ${mode} context instead of the sweep parent`, async () => {
    const { database, telemetry } = await createEmailContextFixture();
    try {
      const now = () => new Date("2026-09-08T12:05:00Z");
      const actor = randomUUID();
      const first: NotificationEvent = {
        contractVersion: "inside.notification-event.v1",
        messageId: randomUUID(),
        occurrenceRef: randomUUID(),
        sourceRef: randomUUID(),
        sourceRevision: 1,
        eventType: "billing.notice-ready",
        accountRef: actor,
        kind: "payment_succeeded",
        occurredAt: "2026-09-08T12:00:00Z",
        notAfter: "2026-09-08T13:00:00Z",
      };
      const event =
        mode === "same-source-null"
          ? first
          : { ...first, messageId: randomUUID(), sourceRevision: 2 };
      const source: NotificationSource = {
        status: "current",
        event,
        content: { category: "subscription", kind: "payment_succeeded" },
        accountId: actor,
        title: "Synthetic",
        readerPath: "/example",
        amountMinor: 100,
      };
      const binding: Binding = {
        channel: "email",
        accountRef: actor,
        contactRef: randomUUID(),
        contactRevision: 1,
      };
      const id = randomUUID();
      const delivery = randomUUID();
      await database.prisma.notification.create({
        data: {
          id,
          kind: event.eventType,
          occurrenceRef: event.occurrenceRef,
          accountId: actor,
          eventPayload: JSON.stringify(event),
          sourceRevision: event.sourceRevision,
          createdAt: now(),
        },
      });
      await database.prisma.notificationDelivery.create({
        data: {
          id: delivery,
          notificationId: id,
          channel: "email",
          updatedAt: now(),
        },
      });
      const command = deliverySchema.parse({
        contractVersion: "inside.notification-delivery.v1",
        operationId: randomUUID(),
        notificationRef: id,
        deliveryRef: delivery,
        commandRevision: 1,
        sourceEventId: first.messageId,
        content: source.content,
        ...renderNotification(source, "https://inside.example.test"),
        binding,
        issuedAt: first.occurredAt,
        notAfter: "2026-09-08T12:01:00Z",
      });
      await database.prisma.$transaction((transaction) =>
        stageDeliveryCommand(transaction, command, now(), null),
      );
      await database.prisma.notificationDelivery.update({
        where: { id: delivery },
        data: { state: "suppressed", reason: "expired", nextCommandAt: now() },
      });
      if (mode !== "changed-source-gap") {
        const envelope = encodeNotification("billing", event);
        await database.prisma.notificationInbox.create({
          data: {
            scope: "billing",
            messageId: event.messageId,
            lane: "billing",
            payload: envelope.payload,
            digest: envelope.digest,
            traceparent: original,
            completedAt: now(),
          },
        });
      }
      const deps: NotificationDependencies = {
        prisma: database.prisma,
        now,
        origin: "https://inside.example.test",
        sources: {
          resolve: () => Promise.resolve(source),
          canRead: () => Promise.resolve("allowed"),
        },
        recipients: {
          exists: () => Promise.resolve(true),
          enumerate: () => Promise.resolve([]),
          binding: () => Promise.resolve(binding),
          email: () => Promise.resolve("private-recipient@example.test"),
        },
      };
      const unrelated = telemetry.startHttp({
        method: "GET",
        route: "/unrelated",
      });
      await unrelated.run(() => refreshDeliveries(deps));
      unrelated.finish(200, 1);
      const replacement =
        await database.prisma.notificationCommand.findUniqueOrThrow({
          where: { deliveryId_revision: { deliveryId: delivery, revision: 2 } },
        });
      expect(replacement.traceparent).toBe(
        mode === "changed-source" ? original : null,
      );
      expect(
        deliverySchema.parse(JSON.parse(replacement.payload)),
      ).toMatchObject({ sourceEventId: event.messageId, commandRevision: 2 });
      expect(
        await database.prisma.notificationOutbox.findUniqueOrThrow({
          where: {
            scope_messageId: {
              scope: "notifications",
              messageId: replacement.operationId,
            },
          },
        }),
      ).toMatchObject({ traceparent: replacement.traceparent });
      expect(
        await database.prisma.notificationCommand.findUniqueOrThrow({
          where: { operationId: command.operationId },
        }),
      ).toMatchObject({ traceparent: null });
    } finally {
      await finishFixtureCleanup([
        () => telemetry.shutdown(),
        () => database.dispose(),
      ]);
    }
  });
}
