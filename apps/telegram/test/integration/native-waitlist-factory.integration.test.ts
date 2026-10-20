// deterministic-test-allow unit-io: actual managed Nest/Fastify, genuine owned PostgreSQL and bounded loopback SDK JSON receiver. Native execution requires hosted services; every owner closes in finally.
import { createServer, request, type ClientRequest } from "node:http";
import { once } from "node:events";
import { sql } from "kysely";
import { z } from "zod";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterEach, expect, test, vi } from "vitest";
import { createTelegramApplication } from "../../src/application/create-telegram-application.js";
import { loadApplicationConfig } from "../../src/config/application-config.js";
import { createDatabase } from "../../src/database/create-database.js";
import { DATABASE, type Database } from "../../src/database/database.js";
import { migrateToLatest } from "../../src/database/migrator.js";
import {
  TELEGRAM_OBSERVABILITY,
  type TelegramObservability,
} from "../../src/observability/telegram-observability.js";
import { deferred } from "../support/deferred.js";
import { required } from "../support/required.js";

const BOT = "native_headers";
const SECRET = "synthetic_native_communications_secret_1566";
const MARKER = "PRIVATE_NATIVE_HEADER_1566";
const TRACE = "1234567890abcdef1234567890abcdef";
const PARENT = "1234567890abcdef";
const CANONICAL = `00-${TRACE}-${PARENT}-01`;
const FACT_BUDGET_MS = 10_000;
const MAX_BODY_BYTES = 1_048_576;
const spanSchema = z.object({
  name: z.enum([
    "waitlist receipt",
    "POST /integrations/platform/v1/communications",
  ]),
  traceId: z.string().regex(/^[0-9a-f]{32}$/),
  spanId: z.string().regex(/^[0-9a-f]{16}$/),
  parentSpanId: z.string().optional(),
  kind: z.number(),
});
const tracesSchema = z.object({
  resourceSpans: z.array(
    z.object({ scopeSpans: z.array(z.object({ spans: z.array(spanSchema) })) }),
  ),
});
const pointSchema = z.object({
  attributes: z
    .array(
      z.object({
        key: z.string(),
        value: z.object({ stringValue: z.string() }),
      }),
    )
    .optional()
    .default([]),
  asDouble: z.number().optional(),
  asInt: z
    .string()
    .regex(/^(?:0|[1-9][0-9]{0,18})$/)
    .optional(),
});
const metricsSchema = z.object({
  resourceMetrics: z.array(
    z.object({
      scopeMetrics: z.array(
        z.object({
          metrics: z.array(
            z.object({
              name: z.string(),
              sum: z.object({ dataPoints: z.array(pointSchema) }).optional(),
              histogram: z
                .object({ dataPoints: z.array(pointSchema) })
                .optional(),
            }),
          ),
        }),
      ),
    }),
  ),
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function confirmation(index: number) {
  return {
    contractVersion: "inside.waitlist-confirmation.v1" as const,
    eventId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    intakeId: "11111111-1111-4111-8111-111111111111",
    accountRef: MARKER,
    telegramIdentityRef: MARKER + "_IDENTITY",
    linkRevision: 1,
  };
}

/** Actual serialized SDK observations, not a pinned collector/full stored-row verdict. */
async function withFactory(
  mode: "on" | "off" | "ratio0",
  work: (context: {
    readonly application: NestFastifyApplication;
    readonly handle: ReturnType<typeof createTelegramApplication>;
    readonly observer: Database;
    readonly applicationName: string;
    readonly port: number;
    readonly spans: z.infer<typeof spanSchema>[];
    readonly metricNames: string[];
    readonly business: { metric: string; point: z.infer<typeof pointSchema> }[];
    stage(name: string): void;
    beforeClose(action: () => Promise<void>): void;
    expectedCloseFailure(error: unknown): void;
  }) => Promise<void>,
): Promise<void> {
  const spans: z.infer<typeof spanSchema>[] = [];
  const metricNames: string[] = [];
  const business: { metric: string; point: z.infer<typeof pointSchema> }[] = [];
  const failures: unknown[] = [];
  let stage = "acquisition";
  let firstStage: string | undefined;
  let cleanupFailures = 0;
  let invalidBodies = 0;
  let privateBodies = 0;
  let observer: Database | undefined;
  let handle: ReturnType<typeof createTelegramApplication> | undefined;
  let releaseHeld = (): Promise<void> => Promise.resolve();
  let expected: { readonly error: unknown } | undefined;
  const receiver = createServer((req, res) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    req.on("data", (chunk: unknown) => {
      if (!Buffer.isBuffer(chunk)) {
        invalidBodies += 1;
        req.destroy();
        return;
      }
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        invalidBodies += 1;
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const value: unknown = JSON.parse(
          Buffer.concat(chunks).toString("utf8"),
        );
        const encoded = JSON.stringify(value);
        if (typeof encoded !== "string") throw new Error();
        if (encoded.includes(MARKER) || encoded.includes(SECRET))
          privateBodies += 1;
        if (req.method !== "POST") throw new Error();
        if (req.url === "/v1/traces") {
          const parsed = tracesSchema.safeParse(value);
          if (!parsed.success) throw new Error();
          for (const resource of parsed.data.resourceSpans)
            for (const scope of resource.scopeSpans) spans.push(...scope.spans);
        } else if (req.url === "/v1/metrics") {
          const parsed = metricsSchema.safeParse(value);
          if (!parsed.success) throw new Error();
          for (const resource of parsed.data.resourceMetrics)
            for (const scope of resource.scopeMetrics) {
              for (const metric of scope.metrics) {
                metricNames.push(metric.name);
                if (
                  metric.name === "inside.telegram.operations" ||
                  metric.name === "inside.telegram.duration"
                )
                  for (const point of metric.sum?.dataPoints ??
                    metric.histogram?.dataPoints ??
                    [])
                    business.push({ metric: metric.name, point });
              }
            }
        } else throw new Error();
      } catch {
        invalidBodies += 1;
      }
      res.writeHead(200, { "content-type": "application/json" }).end("{}");
    });
  });
  const capture = (error: unknown, cleanup: boolean): void => {
    if (failures.includes(error)) return;
    failures.push(error);
    firstStage ??= stage;
    if (cleanup) cleanupFailures += 1;
  };
  try {
    const baseUrl = new URL(required(process.env["DATABASE_URL"]));
    if (!["127.0.0.1", "localhost"].includes(baseUrl.hostname))
      throw new Error("Owned loopback PostgreSQL required");
    observer = createDatabase(baseUrl.toString());
    await migrateToLatest(observer);
    await observer
      .deleteFrom("waitlist_confirmations")
      .where("bot_identity", "=", BOT)
      .execute();
    receiver.listen(0, "127.0.0.1");
    await once(receiver, "listening");
    const address = receiver.address();
    if (address === null || typeof address === "string")
      throw new Error("Owned collector unavailable");
    for (const key of Object.keys(process.env))
      if (key.startsWith("OTEL_EXPORTER_OTLP")) vi.stubEnv(key, undefined);
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("INSIDE_OTEL_ENABLED", mode === "off" ? "false" : "true");
    vi.stubEnv("INSIDE_OTEL_ENDPOINT", `http://127.0.0.1:${address.port}`);
    vi.stubEnv("INSIDE_OTEL_SAMPLE_RATIO", mode === "ratio0" ? "0" : "1");
    const applicationName = `native-headers-${mode}`;
    baseUrl.searchParams.set("application_name", applicationName);
    const config = loadApplicationConfig({
      DATABASE_URL: baseUrl.toString(),
      TELEGRAM_BOT_IDENTITY: BOT,
      TELEGRAM_WEBHOOK_SECRET: "synthetic_webhook_secret_00000000",
      PLATFORM_INTEGRATION_SECRET: "synthetic_platform_secret_0000000",
      PLATFORM_COMMUNICATIONS_SECRET: SECRET,
      WORKERS_ENABLED: "false",
      TELEGRAM_CANONICAL_CHAT_ID: "-1000000000000",
      TELEGRAM_LINK_RECEIPT_TEXT: "Synthetic receipt",
      TELEGRAM_LINKED_MEMBER_TEXT: "Synthetic member",
      TELEGRAM_LINKED_NON_MEMBER_TEXT: "Synthetic nonmember",
      TELEGRAM_LINKED_UNAVAILABLE_TEXT: "Synthetic unavailable",
      TELEGRAM_WELCOME_TEXT: "Synthetic welcome",
    });
    handle = createTelegramApplication({ ...config, port: 0 });
    const application = required(await handle.application);
    const port = Number(new URL(await application.getUrl()).port);
    await work({
      application,
      handle,
      observer,
      applicationName,
      port,
      spans,
      metricNames,
      business,
      stage: (name) => {
        stage = name;
      },
      beforeClose: (action) => {
        releaseHeld = action;
      },
      expectedCloseFailure: (error) => {
        expected = { error };
      },
    });
  } catch (error: unknown) {
    capture(error, false);
  } finally {
    for (const [name, cleanup] of [
      ["cleanup_held_operation", releaseHeld],
      [
        "cleanup_application",
        async () => {
          try {
            await handle?.close();
          } catch (error: unknown) {
            if (expected === undefined || error !== expected.error) throw error;
          }
        },
      ],
      [
        "cleanup_fixture_rows",
        async () => {
          await observer
            ?.deleteFrom("waitlist_confirmations")
            .where("bot_identity", "=", BOT)
            .execute();
        },
      ],
      [
        "cleanup_observer",
        async () => {
          await observer?.destroy();
        },
      ],
      [
        "cleanup_receiver",
        async () => {
          if (receiver.listening)
            await new Promise<void>((resolve, reject) =>
              receiver.close((error) =>
                error === undefined ? resolve() : reject(error),
              ),
            );
        },
      ],
    ] as const) {
      stage = name;
      try {
        await cleanup();
      } catch (error: unknown) {
        capture(error, true);
      }
    }
  }
  if (invalidBodies !== 0 || privateBodies !== 0) {
    stage = "sdk_json_privacy";
    capture(new Error("SDK JSON observation refused"), false);
  }
  if (failures.length > 0)
    throw new Error(
      JSON.stringify({
        proof: "telegram_native_factory",
        outcome: "failed",
        stage: firstStage,
        failures: failures.length,
        cleanup_failures: cleanupFailures,
      }),
    );
}

function post(
  port: number,
  body: unknown,
  raw: readonly string[],
  authorized = true,
): {
  readonly client: ClientRequest;
  readonly result: Promise<{ readonly status: number; readonly body: unknown }>;
} {
  const encoded = JSON.stringify(body);
  let client!: ClientRequest;
  const result = new Promise<{ status: number; body: unknown }>(
    (resolve, reject) => {
      client = request(
        {
          host: "127.0.0.1",
          port,
          path: "/integrations/platform/v1/communications",
          method: "POST",
          headers: [
            "Host",
            `127.0.0.1:${port}`,
            "Authorization",
            authorized
              ? `Bearer ${SECRET}`
              : "Bearer synthetic_wrong_secret_00000000",
            "Content-Type",
            "application/json",
            "Content-Length",
            String(Buffer.byteLength(encoded)),
            "Connection",
            "close",
            "baggage",
            `private=${MARKER}`,
            "tracestate",
            `vendor=${MARKER}`,
            ...raw,
          ],
        },
        (response) => {
          let text = "";
          response.setEncoding("utf8");
          response.on("data", (chunk: string) => {
            text += chunk;
            if (Buffer.byteLength(text) > 8192)
              client.destroy(new Error("Native response exceeded budget"));
          });
          response.on("error", reject);
          response.on("end", () => {
            try {
              const value: unknown = JSON.parse(text);
              resolve({ status: response.statusCode ?? 0, body: value });
            } catch {
              reject(new Error("Native response JSON invalid"));
            }
          });
        },
      );
      client.on("error", reject);
      // deterministic-test-allow duration-wait: bound this owned native HTTP fact, never application shutdown.
      client.setTimeout(FACT_BUDGET_MS, () =>
        client.destroy(new Error("Native HTTP fact deadline")),
      );
      client.end(encoded);
    },
  );
  return { client, result };
}

const headerCases = [
  { name: "valid01", headers: ["traceparent", CANONICAL], admitted: true },
  {
    name: "valid00",
    headers: ["traceparent", `00-${TRACE}-${PARENT}-00`],
    admitted: true,
  },
  { name: "mixed_name", headers: ["TrAcEpArEnT", CANONICAL], admitted: true },
  {
    name: "node_normalized_ows",
    headers: ["traceparent", ` \t${CANONICAL} \t`],
    admitted: true,
  },
  { name: "absent", headers: [], admitted: false },
  {
    name: "duplicate",
    headers: ["traceparent", CANONICAL, "traceparent", CANONICAL],
    admitted: false,
  },
  {
    name: "mixed_duplicate",
    headers: ["Traceparent", CANONICAL, "TRACEPARENT", CANONICAL],
    admitted: false,
  },
  {
    name: "coalesced",
    headers: ["traceparent", `${CANONICAL},${CANONICAL}`],
    admitted: false,
  },
  {
    name: "uppercase",
    headers: ["traceparent", `00-${TRACE.toUpperCase()}-${PARENT}-01`],
    admitted: false,
  },
  {
    name: "zero_trace",
    headers: ["traceparent", `00-${"0".repeat(32)}-${PARENT}-01`],
    admitted: false,
  },
  {
    name: "zero_parent",
    headers: ["traceparent", `00-${TRACE}-${"0".repeat(16)}-01`],
    admitted: false,
  },
  {
    name: "version",
    headers: ["traceparent", `01-${TRACE}-${PARENT}-01`],
    admitted: false,
  },
  {
    name: "flags",
    headers: ["traceparent", `00-${TRACE}-${PARENT}-02`],
    admitted: false,
  },
  {
    name: "suffix",
    headers: ["traceparent", CANONICAL + "-extra"],
    admitted: false,
  },
  {
    name: "remaining_whitespace",
    headers: ["traceparent", `00-${TRACE} -${PARENT}-01`],
    admitted: false,
  },
] as const;

test("actual managed factory admits only authenticated strict Node-parsed receipt parents", async () => {
  await withFactory("on", async (ctx) => {
    const saved = new Map<string, string | null>();
    for (const [index, entry] of headerCases.entries()) {
      ctx.stage("header_" + entry.name);
      const body = confirmation(index + 1);
      const response = await post(ctx.port, body, entry.headers).result;
      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        eventId: body.eventId,
        status: "accepted",
      });
      const row = await ctx.observer
        .selectFrom("waitlist_confirmations")
        .select("receipt_traceparent")
        .where("bot_identity", "=", BOT)
        .where("event_id", "=", body.eventId)
        .executeTakeFirstOrThrow();
      saved.set(body.eventId, row.receipt_traceparent);
      if (entry.admitted)
        expect(row.receipt_traceparent).toMatch(
          new RegExp(`^00-${TRACE}-[0-9a-f]{16}-01$`),
        );
      else expect(row.receipt_traceparent).toBeNull();
    }
    ctx.stage("auth_strict_decode");
    const unauthorized = confirmation(500);
    expect(
      (
        await post(ctx.port, unauthorized, ["traceparent", CANONICAL], false)
          .result
      ).status,
    ).toBe(401);
    const malformed = confirmation(501);
    expect(
      (
        await post(ctx.port, { ...malformed, extra: MARKER }, [
          "traceparent",
          CANONICAL,
        ]).result
      ).status,
    ).toBe(400);
    for (const body of [unauthorized, malformed])
      expect(
        await ctx.observer
          .selectFrom("waitlist_confirmations")
          .select("event_id")
          .where("bot_identity", "=", BOT)
          .where("event_id", "=", body.eventId)
          .executeTakeFirst(),
      ).toBeUndefined();
    ctx.stage("null_replay_conflict");
    expect(
      (await post(ctx.port, confirmation(5), ["traceparent", CANONICAL]).result)
        .status,
    ).toBe(200);
    expect(
      (
        await post(
          ctx.port,
          { ...confirmation(1), accountRef: MARKER + "_CONFLICT" },
          ["traceparent", CANONICAL],
        ).result
      ).status,
    ).toBe(409);
    for (const [eventId, carrier] of saved)
      expect(
        (
          await ctx.observer
            .selectFrom("waitlist_confirmations")
            .select("receipt_traceparent")
            .where("bot_identity", "=", BOT)
            .where("event_id", "=", eventId)
            .executeTakeFirstOrThrow()
        ).receipt_traceparent,
      ).toBe(carrier);
    ctx.stage("sdk_json_relationships");
    await ctx.handle.close();
    const receipts = ctx.spans.filter(
      (span) => span.name === "waitlist receipt",
    );
    const http = ctx.spans.filter(
      (span) => span.name === "POST /integrations/platform/v1/communications",
    );
    expect(receipts).toHaveLength(17);
    for (const span of receipts) {
      expect(span.kind).toBe(1);
      if (span.parentSpanId === undefined || span.parentSpanId === "")
        expect(span.traceId).not.toBe(TRACE);
      else {
        expect(span.parentSpanId).toBe(PARENT);
        expect(span.traceId).toBe(TRACE);
      }
    }
    expect(http).toHaveLength(19);
    for (const span of http) {
      expect(span.kind).toBe(2);
      expect(span.traceId).not.toBe(TRACE);
      expect(span.parentSpanId === undefined || span.parentSpanId === "").toBe(
        true,
      );
    }
    expect(
      receipts.filter(
        (span) => span.parentSpanId === undefined || span.parentSpanId === "",
      ),
    ).toHaveLength(11);
    for (const carrier of saved.values()) {
      if (carrier === null) continue;
      const fields = carrier.split("-");
      const span = required(
        receipts.find((candidate) => candidate.spanId === fields[2]),
      );
      expect(span.traceId).toBe(TRACE);
      expect(span.parentSpanId).toBe(PARENT);
      expect(span.kind).toBe(1);
    }
    expect(ctx.metricNames).toContain("inside.telegram.operations");
    expect(ctx.business.length).toBeGreaterThan(0);
    for (const { point } of ctx.business) {
      expect(point.attributes.map((attribute) => attribute.key).sort()).toEqual(
        ["operation", "outcome"],
      );
      const values = Object.fromEntries(
        point.attributes.map((attribute) => [
          attribute.key,
          attribute.value.stringValue,
        ]),
      );
      expect(values["operation"]).toBe("receipt");
      expect(["completed", "failed"]).toContain(values["outcome"]);
    }
  });
}, 25_000);

for (const mode of ["off", "ratio0"] as const)
  test(`actual factory local sampling cannot be forced by remote sampled flag (${mode})`, async () => {
    await withFactory(mode, async (ctx) => {
      ctx.stage("sampling_business_receipt");
      const body = confirmation(600);
      expect(
        (await post(ctx.port, body, ["traceparent", CANONICAL]).result).status,
      ).toBe(200);
      const row = await ctx.observer
        .selectFrom("waitlist_confirmations")
        .select("receipt_traceparent")
        .where("bot_identity", "=", BOT)
        .where("event_id", "=", body.eventId)
        .executeTakeFirstOrThrow();
      if (mode === "off") expect(row.receipt_traceparent).toBeNull();
      else
        expect(row.receipt_traceparent).toMatch(
          new RegExp(`^00-${TRACE}-[0-9a-f]{16}-00$`),
        );
      await ctx.handle.close();
      expect(ctx.spans).toEqual([]);
      if (mode === "off") expect(ctx.metricNames).toEqual([]);
      else {
        expect(ctx.metricNames).toContain("inside.telegram.operations");
        const points = ctx.business.filter(
          (metric) => metric.metric === "inside.telegram.operations",
        );
        expect(points.length).toBeGreaterThan(0);
        for (const { point } of points) {
          expect(
            Object.fromEntries(
              point.attributes.map((attribute) => [
                attribute.key,
                attribute.value.stringValue,
              ]),
            ),
          ).toEqual({ operation: "receipt", outcome: "completed" });
          expect(
            point.asDouble ??
              (point.asInt === undefined ? undefined : Number(point.asInt)),
          ).toBe(1);
        }
      }
    });
  }, 25_000);

for (const outcome of ["clean", "cleanup_failures"] as const)
  test(`actual factory waits for disconnected receipt PG work before SDK/PG/framework cleanup (${outcome})`, async () => {
    await withFactory("on", async (ctx) => {
      const body = confirmation(700);
      const release = deferred();
      const locked = deferred();
      const held = ctx.observer.transaction().execute(async (tx) => {
        await sql`select pg_advisory_xact_lock(hashtextextended(${`waitlist-confirmation:${BOT}:${body.eventId}`},0))`.execute(
          tx,
        );
        locked.resolve();
        await release.promise;
      });
      void held.catch(() => undefined);
      ctx.beforeClose(async () => {
        release.resolve();
        await held;
      });
      await Promise.race([
        locked.promise,
        held.then(() => {
          throw new Error("Owned PG lock completed prematurely");
        }),
      ]);
      const order: string[] = [];
      const sdkError = new Error("synthetic after actual SDK cleanup");
      const pgError = new Error("synthetic after actual PG cleanup");
      const nestError = new Error("synthetic after actual Nest cleanup");
      const telemetry = ctx.application.get<TelegramObservability>(
        TELEGRAM_OBSERVABILITY,
      );
      const database = ctx.application.get<Database>(DATABASE);
      const shutdown = telemetry.shutdown.bind(telemetry);
      const destroy = database.destroy.bind(database);
      const close = ctx.application.close.bind(ctx.application);
      // Public lifetime boundaries call their original native cleanup before fault injection.
      const sdk = vi
        .spyOn(telemetry, "shutdown")
        .mockImplementation(async () => {
          order.push("sdk");
          await shutdown();
          order.push("sdk.quiet");
          if (outcome === "cleanup_failures") throw sdkError;
        });
      const pg = vi.spyOn(database, "destroy").mockImplementation(async () => {
        order.push("pg");
        await destroy();
        order.push("pg.quiet");
        if (outcome === "cleanup_failures") throw pgError;
      });
      const framework = vi
        .spyOn(ctx.application, "close")
        .mockImplementation(async () => {
          order.push("framework");
          await close();
          order.push("framework.quiet");
          if (outcome === "cleanup_failures") throw nestError;
        });
      ctx.stage("genuine_pg_handler_wait");
      const pending = post(ctx.port, body, ["traceparent", CANONICAL]);
      const client = pending.client;
      ctx.beforeClose(async () => {
        client.destroy();
        release.resolve();
        await held;
      });
      void pending.result.catch(() => undefined);
      await expect
        .poll(
          async () => {
            const waiting = await sql<{
              count: number;
            }>`select count(*)::int as count from pg_stat_activity where application_name=${ctx.applicationName} and wait_event_type='Lock' and wait_event='advisory'`.execute(
              ctx.observer,
            );
            return waiting.rows[0]?.count;
          },
          { timeout: FACT_BUDGET_MS },
        )
        .toBe(1);
      const disconnected = deferred();
      client.once("close", () => disconnected.resolve());
      client.destroy();
      await disconnected.promise;
      const closing = ctx.handle.close();
      const observed = closing.then(
        () => undefined,
        (error: unknown) => error,
      );
      expect(ctx.handle.close()).toBe(closing);
      expect(sdk).not.toHaveBeenCalled();
      expect(pg).not.toHaveBeenCalled();
      expect(framework).not.toHaveBeenCalled();
      const stillWaiting = await sql<{
        count: number;
      }>`select count(*)::int as count from pg_stat_activity where application_name=${ctx.applicationName} and wait_event_type='Lock' and wait_event='advisory'`.execute(
        ctx.observer,
      );
      expect(stillWaiting.rows[0]?.count).toBe(1);
      expect(sdk).not.toHaveBeenCalled();
      ctx.stage("actual_cleanup_and_original_failures");
      release.resolve();
      await held;
      const result = await observed;
      if (outcome === "cleanup_failures") {
        if (!(result instanceof AggregateError))
          throw new Error("Expected private original cleanup aggregate");
        const originals: readonly unknown[] = result.errors;
        expect(originals).toEqual([sdkError, pgError, nestError]);
        ctx.expectedCloseFailure(result);
      } else expect(result).toBeUndefined();
      expect(sdk).toHaveBeenCalledOnce();
      expect(pg).toHaveBeenCalledOnce();
      expect(framework).toHaveBeenCalledOnce();
      expect(order).toEqual([
        "sdk",
        "sdk.quiet",
        "pg",
        "pg.quiet",
        "framework",
        "framework.quiet",
      ]);
      expect(
        (
          await ctx.observer
            .selectFrom("waitlist_confirmations")
            .select("state")
            .where("bot_identity", "=", BOT)
            .where("event_id", "=", body.eventId)
            .executeTakeFirstOrThrow()
        ).state,
      ).toBe("pending");
      expect(ctx.spans.some((span) => span.name === "waitlist receipt")).toBe(
        true,
      );
      expect(ctx.metricNames).toContain("inside.telegram.operations");
      const sessions = await sql<{
        count: number;
      }>`select count(*)::int as count from pg_stat_activity where application_name=${ctx.applicationName}`.execute(
        ctx.observer,
      );
      expect(sessions.rows[0]?.count).toBe(0);
    });
  }, 25_000);
