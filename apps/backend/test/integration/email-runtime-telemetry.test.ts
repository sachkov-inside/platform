import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { expect, test, vi } from "vitest";
import { z } from "zod";
import { parsePlatformConfig } from "../../src/config/platform-config.js";
import { createApiApplication } from "../../src/entrypoints/api/create-api-application.js";
import {
  connectNotificationBroker,
  publishNotification,
} from "../../src/infrastructure/notification-transport/rabbitmq.js";
import { encodeNotification } from "../../src/infrastructure/notification-transport/wire.js";
import { localNotificationTopology } from "../../src/infrastructure/notification-transport/topology.js";
import { BillingContact } from "../../src/modules/accounts/facets/billing-contact/billing-contact.js";
import { billingContactProtection } from "../../src/modules/accounts/infrastructure/billing-contact-protection.js";
import { assembleMaterials } from "../../src/modules/materials/index.js";
import { Notifications } from "../../src/modules/notifications/index.js";
import { representativeDocument } from "../fixtures/material-body/representative.js";
import { startNotificationBroker } from "./setup/broker.js";
import { startEmailSmtp } from "./setup/email-smtp.js";
import { eventually } from "./setup/eventually.js";
import {
  boundedProcessFact,
  finishFixtureCleanup,
  launchQueueTelemetryProcess,
  type QueueTelemetryProcess,
} from "./setup/queue-telemetry-process.js";
import { startTestIdentityIssuer } from "./setup/test-identity-issuer.js";
import { createMigratedTestDatabase } from "./setup/test-database.js";

const FACT_BUDGET_MS = 25_000;
const EMAIL = "private-email-sentinel@example.test";
const TITLE = "private-email-title-sentinel";
const BODY = "private-email-body-sentinel";
const ENCRYPTION_KEY = Buffer.alloc(32, 42).toString("base64");
const diagnosticResource = z.looseObject({
  resource: z
    .looseObject({
      attributes: z
        .array(
          z.looseObject({
            key: z.string(),
            value: z.looseObject({ stringValue: z.string().optional() }),
          }),
        )
        .optional(),
    })
    .optional(),
});
const diagnosticExport = z.looseObject({
  resourceSpans: z.array(diagnosticResource).optional(),
  resourceMetrics: z.array(diagnosticResource).optional(),
});
/** Only closed classifications survive; raw attributes, JSON errors and payloads never enter diagnostics. */
function exportDiagnosticCounts(wire: readonly string[]) {
  const counts = {
    traces: { api: 0, worker: 0, other: 0 },
    metrics: { api: 0, worker: 0, other: 0 },
    other: { api: 0, worker: 0, other: 0 },
  };
  for (const body of wire) {
    try {
      const parsed = diagnosticExport.parse(JSON.parse(body));
      const resources = [
        ...(parsed.resourceSpans ?? []),
        ...(parsed.resourceMetrics ?? []),
      ];
      const services = resources.flatMap((resource) =>
        (resource.resource?.attributes ?? [])
          .filter((attribute) => attribute.key === "service.name")
          .map((attribute) => attribute.value.stringValue),
      );
      const service =
        services.length > 0 &&
        services.every((value) => value === "platform-api")
          ? "api"
          : services.length > 0 &&
              services.every(
                (value) => value === "platform-notifications-worker",
              )
            ? "worker"
            : "other";
      const signal =
        parsed.resourceSpans !== undefined &&
        parsed.resourceMetrics === undefined
          ? "traces"
          : parsed.resourceMetrics !== undefined &&
              parsed.resourceSpans === undefined
            ? "metrics"
            : "other";
      counts[signal][service]++;
    } catch {
      counts.other.other++;
    }
  }
  return counts;
}
const spanSchema = z.looseObject({
  name: z.string(),
  traceId: z.string(),
  spanId: z.string(),
  parentSpanId: z.string().optional(),
  attributes: z
    .array(
      z.object({
        key: z.string(),
        value: z.record(z.string(), z.unknown()),
      }),
    )
    .optional(),
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
function spansFrom(wire: readonly string[]) {
  const logical = new Map<string, z.infer<typeof spanSchema>>();
  for (const body of wire) {
    const spans =
      exportSchema
        .parse(JSON.parse(body))
        .resourceSpans?.flatMap((resource) =>
          resource.scopeSpans.flatMap((scope) => scope.spans),
        ) ?? [];
    const identities = new Set<string>();
    for (const span of spans) {
      expect(span.traceId).toMatch(/^[0-9a-f]{32}$/u);
      expect(span.traceId).not.toBe("0".repeat(32));
      expect(span.spanId).toMatch(/^[0-9a-f]{16}$/u);
      expect(span.spanId).not.toBe("0".repeat(16));
      const id = `${span.traceId}/${span.spanId}`;
      expect(identities.has(id)).toBe(false);
      identities.add(id);
      const previous = logical.get(id);
      if (previous !== undefined) expect(span).toEqual(previous);
      logical.set(id, span);
    }
  }
  return [...logical.values()];
}
const emailPairs = {
  "publish emailMaterial": [
    "publish",
    "emailMaterial",
    "inside.notifications.email.v1",
    4,
  ],
  "receive emailMaterial": [
    "receive",
    "emailMaterial",
    "inside.notifications.email.v1",
    5,
  ],
  "dispatch emailMaterial": [
    "dispatch",
    "emailMaterial",
    "inside.notifications.email.v1",
    1,
  ],
  "publish emailResult": [
    "publish",
    "emailResult",
    "inside.results.email.v1",
    4,
  ],
  "receive emailResult": [
    "receive",
    "emailResult",
    "inside.results.email.v1",
    5,
  ],
  "project emailResult": [
    "project",
    "emailResult",
    "inside.results.email.v1",
    1,
  ],
} as const;
function assertRegisteredSpans(spans: ReturnType<typeof spansFrom>) {
  for (const span of spans) {
    const attrs = Object.fromEntries(
      (span.attributes ?? []).map((attribute) => [
        attribute.key,
        attribute.value["stringValue"],
      ]),
    );
    expect(span.attributes?.length ?? 0).toBe(Object.keys(attrs).length);
    const pair = Object.entries(emailPairs).find(
      ([name]) => name === span.name,
    )?.[1];
    if (pair !== undefined) {
      const [operation, lane, destination, kind] = pair;
      expect(span["kind"]).toBe(kind);
      expect(attrs).toEqual({
        "messaging.system": "rabbitmq",
        "messaging.destination.name": destination,
        "messaging.operation.name": operation,
        "email.lane": lane,
      });
    } else if (span.name === "smtp send") {
      expect(span["kind"]).toBe(3);
      expect(attrs).toEqual({
        "dependency.name": "smtp",
        "dependency.operation": "send",
        "dependency.outcome": "sent",
      });
    } else if (span.name.startsWith("postgresql ")) {
      const operation = z
        .enum(["acquire", "query", "material-slug-lock"])
        .parse(span.name.slice("postgresql ".length));
      expect(span["kind"]).toBe(operation === "material-slug-lock" ? 1 : 3);
      expect(attrs).toEqual({
        "dependency.name": "postgresql",
        "dependency.operation": operation,
        "dependency.outcome": z
          .enum(["completed", "failed"])
          .parse(attrs["dependency.outcome"]),
      });
    } else {
      // This fixture exercises only the reviewed HTTP/material lane in addition to email and SQL.
      expect([
        "PUT /authoring/materials/:materialId",
        "publish materials",
        "receive materials",
        "audience materials",
      ]).toContain(span.name);
    }
    expect(span["events"] ?? []).toEqual([]);
    expect(span["links"] ?? []).toEqual([]);
  }
}
const metricWire = z.looseObject({
  resourceMetrics: z
    .array(
      z.looseObject({
        scopeMetrics: z.array(
          z.looseObject({
            metrics: z.array(
              z.looseObject({ name: z.string(), sum: z.unknown().optional() }),
            ),
          }),
        ),
      }),
    )
    .optional(),
});
const emailSum = z.looseObject({
  dataPoints: z.array(
    z.looseObject({
      asDouble: z.number(),
      attributes: z.array(
        z.object({
          key: z.string(),
          value: z.object({ stringValue: z.string() }),
        }),
      ),
    }),
  ),
});
function smtpCounts(wire: readonly string[]) {
  const counts: number[] = [];
  const allowed = new Set([
    "publishMaterial",
    "receiveMaterial",
    "dispatchMaterial",
    "publishResult",
    "receiveResult",
    "projectResult",
  ]);
  for (const body of wire)
    for (const resource of metricWire.parse(JSON.parse(body)).resourceMetrics ??
      [])
      for (const scope of resource.scopeMetrics)
        for (const metric of scope.metrics) {
          if (metric.name !== "inside.email.operations") continue;
          expect(metric.sum).toBeDefined();
          for (const point of emailSum.parse(metric.sum).dataPoints) {
            expect(point.attributes).toHaveLength(2);
            const labels = Object.fromEntries(
              point.attributes.map((attribute) => [
                attribute.key,
                attribute.value.stringValue,
              ]),
            );
            expect(Object.keys(labels).sort()).toEqual([
              "operation",
              "outcome",
            ]);
            if (labels["operation"] === "smtpSend") {
              expect(labels["outcome"]).toBe("sent");
              counts.push(point.asDouble);
            } else {
              expect(allowed.has(labels["operation"] ?? "")).toBe(true);
              expect(labels["outcome"]).toBe("completed");
            }
          }
        }
  return counts;
}
const protocolSchema = z.looseObject({ kind: z.string() });
async function processFact(child: QueueTelemetryProcess, kind: string) {
  let found: z.infer<typeof protocolSchema> | undefined;
  await eventually(() => {
    expect(
      child.messages.some(
        (value) => protocolSchema.parse(value).kind === "fixture-failed",
      ),
    ).toBe(false);
    found = child.messages
      .map((value) => protocolSchema.parse(value))
      .find((value) => value.kind === kind);
    expect(child.outputOverflow).toBe(false);
    expect(child.protocolFailed).toBe(false);
    expect(found).toBeDefined();
    return Promise.resolve();
  }, FACT_BUDGET_MS);
  if (found === undefined) throw new Error("email process fact missing");
  return found;
}
type Phase =
  | "normal"
  | "before-smtp"
  | "after-smtp"
  | "before-result-ack"
  | "legacy-command";
const scenarios: readonly {
  name: string;
  enabled: boolean;
  phase: Phase;
  exporterFailure?: boolean;
}[] = [
  { name: "normal", enabled: true, phase: "normal" },
  { name: "OFF", enabled: false, phase: "normal" },
  {
    name: "exporter503",
    enabled: true,
    phase: "normal",
    exporterFailure: true,
  },
  ...([1, 2] as const).flatMap((repeat) =>
    (["before-smtp", "after-smtp", "before-result-ack"] as const).map(
      (phase) => ({ name: `${phase} SIGKILL ${repeat}`, enabled: true, phase }),
    ),
  ),
  { name: "legacy NULL resumed ON", enabled: true, phase: "legacy-command" },
];

// Real-clock contract: HTTP/JWT, PostgreSQL defaults and the child process share real time.
// Assertions use owner signals and committed state, never absolute dates or elapsed sleeps.
test.each(scenarios)(
  "real HTTP/Rabbit/SMTP email preserves observation and delivery: $name",
  async (scenario) => {
    const cleanup: (() => unknown)[] = [];
    const children: QueueTelemetryProcess[] = [];
    const wire: string[] = [];
    const logs: string[] = [];
    let overflow = false;
    const requestCounts = { traces: 0, metrics: 0, other: 0 };
    const rejectedRequests = { bodyLimit: 0, exportLimit: 0 };
    const database = await createMigratedTestDatabase();
    cleanup.push(() => database.dispose());
    try {
      const info = vi
        .spyOn(console, "info")
        .mockImplementation((...args: unknown[]) => {
          logs.push(args.map(String).join(" "));
        });
      const warn = vi
        .spyOn(console, "warn")
        .mockImplementation((...args: unknown[]) => {
          logs.push(args.map(String).join(" "));
        });
      cleanup.push(
        () => info.mockRestore(),
        () => warn.mockRestore(),
      );
      const collector = createServer((request, response) => {
        // Classify the route, never retain a URL or headers.
        const signal =
          request.url === "/v1/traces"
            ? "traces"
            : request.url === "/v1/metrics"
              ? "metrics"
              : "other";
        requestCounts[signal]++;
        let rejected = false;
        let body = "";
        request.setEncoding("utf8");
        request.on("data", (chunk: string) => {
          if (
            Buffer.byteLength(body) + Buffer.byteLength(chunk) > 1024 * 1024 ||
            wire.length >= 32
          ) {
            if (!rejected) {
              if (
                Buffer.byteLength(body) + Buffer.byteLength(chunk) >
                1024 * 1024
              )
                rejectedRequests.bodyLimit++;
              if (wire.length >= 32) rejectedRequests.exportLimit++;
              rejected = true;
            }
            overflow = true;
            request.destroy();
          } else body += chunk;
        });
        request.on("end", () => {
          wire.push(body);
          response.writeHead(scenario.exporterFailure === true ? 503 : 200, {
            "content-type": "application/json",
            "Retry-After": "Thu, 01 Jan 1970 00:00:00 GMT",
          });
          response.end("{}");
        });
      });
      cleanup.unshift(
        () =>
          new Promise<void>((resolve, reject) => {
            collector.closeAllConnections();
            if (!collector.listening) return resolve();
            collector.close((error) =>
              error === undefined ? resolve() : reject(error),
            );
          }),
      );
      collector.listen(0, "127.0.0.1");
      await once(collector, "listening");
      const address = collector.address();
      if (address === null || typeof address === "string")
        throw new Error("collector address missing");
      const endpoint = `http://127.0.0.1:${address.port}`;
      // The runtime refuses any ambient OTLP transport configuration, so this fixture owns all exporter input.
      for (const key of Object.keys(process.env))
        if (key.startsWith("OTEL_EXPORTER_OTLP")) vi.stubEnv(key, undefined);
      vi.stubEnv("INSIDE_OTEL_ENABLED", scenario.enabled ? "true" : "false");
      vi.stubEnv("INSIDE_OTEL_ENDPOINT", endpoint);
      cleanup.push(() => vi.unstubAllEnvs());
      const smtp = await startEmailSmtp();
      cleanup.unshift(() => smtp.close());
      const identity = await startTestIdentityIssuer({
        issuer: "https://identity.example.test/oidc",
        audience: "https://api.example.test",
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
          NOTIFICATIONS_TELEGRAM_SECRET: "synthetic-notification-secret-00000",
          BILLING_CONTACT_ENCRYPTION_KEY: ENCRYPTION_KEY,
          BILLING_CONTACT_SMTP_HOST: "127.0.0.1",
          BILLING_CONTACT_SMTP_PORT: String(smtp.port),
          BILLING_CONTACT_FROM: "noreply@example.test",
        }),
        { logger: false },
      );
      let appClosed = false;
      const closeApp = async () => {
        if (appClosed) return;
        await app.close();
        appClosed = true;
      };
      cleanup.unshift(closeApp);
      await app.listen(0, "127.0.0.1");
      const owner = randomUUID();
      const topic = randomUUID();
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
        data: { id: topic, slug: "synthetic", name: "Synthetic" },
      });
      // Only contact verification's external code delivery is captured. Notification delivery below uses real Nodemailer SMTP.
      let code: string | undefined;
      const contact = new BillingContact({
        prisma: database.prisma,
        protection: billingContactProtection(ENCRYPTION_KEY),
        documents: [],
        now: () => new Date("2026-01-02T00:00:00Z"),
        sendCode: (message) => {
          code = message.code;
          return Promise.resolve();
        },
      });
      const challenge = await contact.start(owner, {
        operationId: randomUUID(),
        email: EMAIL,
        expectedRevision: 0,
      });
      if (!challenge.ok || code === undefined)
        throw new Error("contact verification setup failed");
      expect(
        await contact.confirm(owner, {
          operationId: randomUUID(),
          challengeRef: challenge.challengeRef,
          code,
        }),
      ).toEqual({ ok: true, revision: 1 });
      const notifications = app.get(Notifications);
      expect(
        await notifications.changePreferences(owner, {
          operationId: randomUUID(),
          expectedRevision: 0,
          email: true,
          telegram: false,
        }),
      ).toMatchObject({ ok: true });
      const metadata = {
        title: TITLE,
        summary: "private-email-summary-sentinel",
        access: "free" as const,
        topicId: topic,
        formatId: "guide",
        tagIds: [],
        difficulty: null,
        outcomes: [],
        seriesIds: [],
      };
      const body = representativeDocument(BODY);
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
      if (!draft.ok) throw new Error("draft setup failed");
      const token = await identity.sign(owner);
      expect(
        (
          await fetch(
            `${await app.getUrl()}/authoring/materials/${draft.value.materialId}`,
            {
              method: "PUT",
              headers: {
                authorization: `Bearer ${token}`,
                "content-type": "application/json",
                "idempotency-key": randomUUID(),
                "x-request-id": "email-http-runtime-proof",
              },
              body: JSON.stringify({
                expectedContentVersion: 1,
                publicationState: "published",
                metadata,
                body,
              }),
            },
          )
        ).status,
      ).toBe(200);
      const source =
        await database.prisma.materialNotificationOutbox.findFirstOrThrow();
      const launch = async (phase: Phase, enabled = scenario.enabled) => {
        const child = launchQueueTelemetryProcess({
          mode: "email",
          databaseUrl: database.url,
          endpoint,
          brokerUrls: {
            billing: broker.urls.billing,
            materials: broker.urls.materials,
            notifications: broker.urls.notifications,
            email: broker.urls.email,
          },
          enabled,
          phase,
          smtpPort: smtp.port,
          encryptionKey: ENCRYPTION_KEY,
        });
        children.push(child);
        // Register before awaiting startup: failed Nest/broker startup still belongs to this fixture.
        cleanup.unshift(() => child.stop());
        await boundedProcessFact(child.firstMessage);
        await processFact(child, "ready");
        return child;
      };
      let child = await launch(
        scenario.phase,
        scenario.phase === "legacy-command" ? false : scenario.enabled,
      );
      const isCrash =
        scenario.phase === "before-smtp" ||
        scenario.phase === "after-smtp" ||
        scenario.phase === "before-result-ack";
      if (scenario.phase === "legacy-command") {
        await processFact(child, "legacy-command-held");
        expect(
          await database.prisma.notificationCommand.findMany({
            select: { traceparent: true },
          }),
        ).toEqual([{ traceparent: null }]);
        expect(smtp.connections).toBe(0);
        await child.stop();
        child = await launch("normal", true);
      } else if (isCrash) {
        if (scenario.phase === "before-result-ack") {
          const confirmed = await processFact(child, "sent-result-confirmed");
          const admitted = await processFact(child, "sent-result-admitted");
          expect(admitted["messageId"]).toBe(confirmed["messageId"]);
          expect(admitted["result"]).toBe("accepted");
          const resultId = z.uuid().parse(confirmed["messageId"]);
          expect(
            await database.prisma.notificationInbox.findUniqueOrThrow({
              where: {
                scope_messageId: { scope: "email", messageId: resultId },
              },
              select: { messageId: true },
            }),
          ).toEqual({ messageId: resultId });
          expect(
            await database.prisma.notificationOutbox.findUniqueOrThrow({
              where: {
                scope_messageId: { scope: "email", messageId: resultId },
              },
              select: { publishedAt: true },
            }),
          ).toEqual({ publishedAt: null });
          expect(smtp.messages.length).toBe(1);
        } else {
          await processFact(
            child,
            scenario.phase === "before-smtp" ? "before-smtp" : "smtp-accepted",
          );
          expect(
            await database.prisma.notificationEmailEffect.findMany({
              select: { state: true },
            }),
          ).toEqual([{ state: "unknown" }]);
          expect(
            await database.prisma.notificationEmailAttempt.findMany({
              select: { state: true, completedAt: true },
            }),
          ).toEqual([{ state: "unknown", completedAt: null }]);
          expect(smtp.messages.length).toBe(
            scenario.phase === "before-smtp" ? 0 : 1,
          );
          if (scenario.phase === "before-smtp")
            expect(smtp.connections).toBe(0);
        }
        await child.stop(); // Supervisor verifies PID/birth ownership and applies SIGKILL with zero grace.
        await boundedProcessFact(child.exited);
        child = await launch("normal");
      }
      const expectedState =
        scenario.phase === "before-smtp" || scenario.phase === "after-smtp"
          ? "unknown"
          : "sent";
      await eventually(async () => {
        expect(
          (await notifications.readDeliveries(owner)).filter(
            (row) => row.channel === "email",
          ),
        ).toMatchObject([
          {
            state: expectedState,
            commandRevision: 1,
            resultRevision: expectedState === "sent" ? 3 : 2,
          },
        ]);
        expect(
          await database.prisma.notificationInbox.count({
            where: { completedAt: null },
          }),
        ).toBe(0);
        expect(
          await database.prisma.notificationOutbox.count({
            where: { publishedAt: null },
          }),
        ).toBe(0);
      }, FACT_BUDGET_MS);
      if (isCrash && expectedState === "unknown") {
        // A second independently reaped restart proves durable unknown is not an uncertain resend.
        await child.stop();
        child = await launch("normal");
        await processFact(child, "sweep");
        expect(
          (await notifications.readDeliveries(owner)).filter(
            (row) => row.channel === "email",
          ),
        ).toMatchObject([{ state: "unknown", resultRevision: 2 }]);
      }
      expect(smtp.messages.length).toBe(
        scenario.phase === "before-smtp" ? 0 : 1,
      );
      expect(smtp.overflow).toBe(false);
      expect(await database.prisma.notificationEmailAttempt.count()).toBe(1);
      const command =
        await database.prisma.notificationCommand.findFirstOrThrow();
      const inbox =
        await database.prisma.notificationEmailInbox.findFirstOrThrow();
      if (scenario.phase !== "before-smtp") {
        const message = smtp.messages[0] ?? "";
        expect(message.includes(EMAIL)).toBe(true);
        expect(
          message.includes(`Message-ID: <${command.operationId}@example.test>`),
        ).toBe(true);
        expect(message.includes("noreply@example.test")).toBe(true);
      }
      expect(inbox.payload).toBe(command.payload);
      // The command protocol stores the bare digest; the transport inbox stores the algorithm prefix.
      expect(command.digest).toMatch(/^[0-9a-f]{64}$/u);
      expect(inbox.digest).toBe(`sha256:${command.digest}`);
      if (scenario.phase === "legacy-command" || !scenario.enabled) {
        expect(command.traceparent).toBeNull();
        expect(inbox.traceparent).toBeNull();
        expect(
          (await database.prisma.notificationEmailAttempt.findFirstOrThrow())
            .traceparent,
        ).toBeNull();
        expect(
          (
            await database.prisma.notificationOutbox.findMany({
              where: { lane: "emailResult" },
            })
          ).every((row) => row.traceparent === null),
        ).toBe(true);
      }
      if (scenario.phase === "legacy-command") {
        const result = z
          .object({ messageId: z.uuid() })
          .parse(
            JSON.parse(
              z
                .string()
                .parse(
                  (
                    await database.prisma.notificationEmailEffect.findFirstOrThrow()
                  ).resultPayload,
                ),
            ),
          );
        const where = {
          scope_messageId: { scope: "email", messageId: result.messageId },
        };
        const original =
          await database.prisma.notificationOutbox.findUniqueOrThrow({ where });
        const duplicatePublisher = await connectNotificationBroker({
          url: broker.urls.notifications,
        });
        cleanup.unshift(() => duplicatePublisher.close());
        await publishNotification(
          duplicatePublisher,
          encodeNotification("emailMaterial", JSON.parse(command.payload)),
          {
            traceparent:
              "00-11111111111111111111111111111111-2222222222222222-01",
          },
        );
        await eventually(async () => {
          const replay =
            await database.prisma.notificationOutbox.findUniqueOrThrow({
              where,
            });
          expect(replay.publishedAt?.getTime()).toBeGreaterThan(
            original.publishedAt?.getTime() ?? Number.POSITIVE_INFINITY,
          );
          expect(replay.traceparent).toBeNull();
          expect(replay.payload).toBe(original.payload);
          expect(replay.digest).toBe(original.digest);
        }, FACT_BUDGET_MS);
        expect(
          (await database.prisma.notificationEmailInbox.findFirstOrThrow())
            .traceparent,
        ).toBeNull();
        expect(
          await database.prisma.notificationResult.count({
            where: { channel: "email" },
          }),
        ).toBe(3);
        expect(smtp.messages.length).toBe(1);
      }
      expect(await child.finish()).toEqual([0, null]);
      await closeApp(); // Flush the genuine API producer before inspecting the complete wire corpus.
      const spans = spansFrom(wire);
      assertRegisteredSpans(spans);
      if (scenario.phase === "legacy-command")
        for (const span of spans.filter(
          (span) => span.name === "publish emailResult",
        )) {
          expect(span.traceId).not.toBe(source.traceparent?.split("-")[1]);
          expect(span.traceId).not.toBe("11111111111111111111111111111111");
        }
      const smtpOperations = smtpCounts(wire);
      if (!scenario.enabled || scenario.phase === "before-smtp")
        expect(smtpOperations).toEqual([]);
      else {
        // Fixed-size numeric/enum diagnostics are emitted only if this assertion fails.
        const diagnostics = JSON.stringify({
          event: "email_runtime_export_counts",
          retainedExports: wire.length,
          requests: requestCounts,
          rejectedRequests,
          overflow,
          signalServiceExports: exportDiagnosticCounts(wire),
          smtpSamples: smtpOperations.length,
        });
        expect(smtpOperations.length, diagnostics).toBeGreaterThan(0);
        // Cumulative samples and exporter retries repeat the same single invocation, never add sends.
        expect(smtpOperations.every((count) => count === 1)).toBe(true);
      }
      if (!scenario.enabled) expect(wire).toEqual([]);
      if (scenario.enabled && scenario.phase === "normal") {
        for (const name of [
          "PUT /authoring/materials/:materialId",
          "publish materials",
          "receive materials",
          "audience materials",
          "publish emailMaterial",
          "receive emailMaterial",
          "dispatch emailMaterial",
          "smtp send",
        ])
          expect(spans.filter((span) => span.name === name)).toHaveLength(1);
        for (const span of spans)
          if (span.parentSpanId !== undefined) {
            expect(
              spans.some(
                (parent) =>
                  parent.traceId === span.traceId &&
                  parent.spanId === span.parentSpanId,
              ),
            ).toBe(true);
            expect(span.parentSpanId).not.toBe(span.spanId);
          }
        const dispatch = spans.find(
          (span) => span.name === "dispatch emailMaterial",
        );
        const smtpSpan = spans.find((span) => span.name === "smtp send");
        expect(smtpSpan?.parentSpanId).toBe(dispatch?.spanId);
        expect(smtpSpan?.traceId).toBe(source.traceparent?.split("-")[1]);
        const one = (name: string) => spans.find((span) => span.name === name);
        for (const [parent, next] of [
          ["PUT /authoring/materials/:materialId", "publish materials"],
          ["publish materials", "receive materials"],
          ["receive materials", "audience materials"],
          ["audience materials", "publish emailMaterial"],
          ["publish emailMaterial", "receive emailMaterial"],
          ["receive emailMaterial", "dispatch emailMaterial"],
        ]) {
          expect(one(next ?? "")?.parentSpanId).toBe(one(parent ?? "")?.spanId);
          expect(one(next ?? "")?.traceId).toBe(one(parent ?? "")?.traceId);
        }
        const attempt =
          await database.prisma.notificationEmailAttempt.findFirstOrThrow();
        expect(attempt.traceparent?.split("-")[2]).toBe(dispatch?.spanId);
        for (const row of await database.prisma.notificationOutbox.findMany({
          where: { lane: "emailResult" },
        })) {
          const result = z
            .object({ state: z.enum(["accepted", "unknown", "sent"]) })
            .parse(JSON.parse(row.payload));
          expect(row.traceparent).toBe(
            result.state === "accepted"
              ? inbox.traceparent
              : attempt.traceparent,
          );
        }
        const resultInbox = await database.prisma.notificationInbox.findMany({
          where: { lane: "emailResult" },
        });
        expect(resultInbox).toHaveLength(3);
        for (const row of resultInbox) {
          const receive = spans.find(
            (span) => span.spanId === row.traceparent?.split("-")[2],
          );
          expect(receive?.name).toBe("receive emailResult");
          expect(
            spans.find((span) => span.spanId === receive?.parentSpanId)?.name,
          ).toBe("publish emailResult");
          expect(
            spans.some(
              (span) =>
                span.name === "project emailResult" &&
                span.parentSpanId === receive?.spanId &&
                span.traceId === receive?.traceId,
            ),
          ).toBe(true);
        }
        for (const name of [
          "publish emailResult",
          "receive emailResult",
          "project emailResult",
        ])
          expect(spans.filter((span) => span.name === name)).toHaveLength(3);
      }
      for (const process of children) {
        expect(process.outputOverflow).toBe(false);
        expect(process.protocolFailed).toBe(false);
      }
      const captured = [
        ...wire,
        ...logs,
        ...children.flatMap((process) => [
          ...process.output,
          JSON.stringify(process.messages),
        ]),
      ].join("\n");
      for (const sentinel of [
        EMAIL,
        TITLE,
        BODY,
        "private-email-summary-sentinel",
        "private-provider-reply-sentinel",
        token,
        owner,
        ENCRYPTION_KEY,
      ])
        expect(captured).not.toContain(sentinel);
      if (scenario.exporterFailure === true) {
        expect(captured).toContain("telemetry_export_failed");
        const attempts = new Map<string, number>();
        for (const payload of wire)
          if (
            (exportSchema.parse(JSON.parse(payload)).resourceSpans?.length ??
              0) > 0
          )
            attempts.set(payload, (attempts.get(payload) ?? 0) + 1);
        expect(attempts.size).toBeGreaterThan(0);
        expect([...attempts.values()].every((count) => count > 1)).toBe(true);
      }
      expect(overflow).toBe(false);
    } finally {
      await finishFixtureCleanup(cleanup);
    }
  },
);
