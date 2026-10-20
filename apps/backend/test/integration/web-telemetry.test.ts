import {
  createPrismaClient,
  Prisma,
} from "../../src/infrastructure/prisma/index.js";
import { createApiApplication } from "../../src/entrypoints/api/create-api-application.js";
import { parsePlatformConfig } from "../../src/config/platform-config.js";
import {
  assembleAccounts,
  bootstrapOwnerAccount,
} from "../../src/modules/accounts/index.js";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";
import { registerWebTelemetryTool } from "../../src/modules/web-telemetry/index.js";
import { afterEach, beforeEach, expect, it } from "vitest";
import { WebTelemetry } from "../../src/modules/web-telemetry/index.js";
import {
  migrateToLatest,
  platformMigrations,
} from "../../src/migrations/index.js";
import { runMigrationsToLatest } from "../../src/infrastructure/postgres/migrate-to-latest.js";
import {
  createMigratedTestDatabase,
  createTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

let database: TestDatabase;
let telemetry: WebTelemetry;
const instant = new Date("2026-10-09T12:00:00Z");
beforeEach(async () => {
  database = await createMigratedTestDatabase();
  telemetry = new WebTelemetry({
    prisma: database.prisma,
    clock: () => instant,
    accounts: {
      checkPermission: () => Promise.resolve({ ok: true, allowed: true }),
    },
  });
});
afterEach(async () => {
  await database.dispose();
});
const vital = (value: number) => ({
  kind: "vitals",
  route: "/products/private-slug",
  mobile: true,
  metrics: [{ name: "LCP", value }],
});
it("preserves telemetry and exact p75 when upgrading the 0087 index", async () => {
  const previous = await createTestDatabase();
  try {
    await runMigrationsToLatest(
      previous.url,
      platformMigrations.slice(
        0,
        platformMigrations.findIndex(
          (migration) =>
            migration.name === "0088_web_telemetry_percentile_index",
        ),
      ),
    );
    const existing = new WebTelemetry({
      prisma: previous.prisma,
      clock: () => new Date("2026-10-08T12:00:00Z"),
      accounts: {
        checkPermission: () => Promise.resolve({ ok: true, allowed: true }),
      },
    });
    for (const value of [100, 200, 300, 400])
      expect(await existing.record(vital(value))).toEqual({ ok: true });
    const before: unknown = await previous.prisma.$queryRaw`
      SELECT percentile_cont(0.75) WITHIN GROUP (ORDER BY value) AS p75,
       count(*)::float8 AS saved FROM web_telemetry.vital_samples
    `;
    expect(before).toEqual([{ p75: 325, saved: 4 }]);
    expect(await migrateToLatest(previous.url)).toEqual({
      appliedMigrations: [
        "0088_web_telemetry_percentile_index",
        "0089_bank_refund_history",
        "0090_explicit_community_rights",
        "0091_product_communities",
        "0092_product_access_exclusions",
        "0093_product_learning_started",
        "0094_individual_payment_links",
        "0095_historical_community_coverage",
        "0096_task_review_progress",
        "0097_task_submission_review_run",
        "0098_material_task",
        "0099_chapter_supplementary_materials",
        "0100_product_waitlists",
        "0101_funnel_diagnostic_candidates",
        "0102_billing_funnel_diagnostic_sources",
        "0103_reading_funnel_diagnostic_sources",
        "0104_telegram_funnel_diagnostic_identities",
        "0105_funnel_diagnostic_current_products",
        "0106_learning_activity_provenance",
        "0107_bookmark_activity_provenance",
        "0108_submission_activity_period",
        "0109_materials_notification_trace_context",
        "0110_notifications_notification_trace_context",
        "0111_notifications_email_trace_context",
      ],
    });
    expect(await existing.summary("owner", 30)).toMatchObject({
      ok: true,
      value: { vitals: [{ p75: 325, saved: 4 }] },
    });
    expect(await migrateToLatest(previous.url)).toEqual({
      appliedMigrations: [],
    });
  } finally {
    await previous.dispose();
  }
});
it("reports deterministic p75 without storing a raw path or visitor identity", async () => {
  for (const value of [100, 200, 300, 400])
    await telemetry.record(vital(value));
  const result = await telemetry.summary("owner", 30);
  expect(result).toMatchObject({
    ok: true,
    value: {
      vitals: [
        {
          route_template: "/products/[slug]",
          device_class: "mobile",
          metric: "LCP",
          p75: 325,
          saved: 4,
          dropped: 0,
          incomplete: false,
        },
      ],
    },
  });
});

it.each([
  [[7], 7],
  [[0, 4], 3],
  [[1, 2, 3], 2.5],
  [[2, 8, 13, 19], 14.5],
  [[0, 1, 2, 3, 4], 3],
  [[0, 1, 2, 3, 4, 5, 6], 4.5],
  [[7, 7, 7, 8], 7.25],
  [[0, 0, 0, 1], 0.25],
  [[1e-200, 1e-100, 1e100], 5e99],
  [[0, 1e-200, 1e-100, 1e100], 2.5e99],
] as const)("keeps exact continuous p75 for %j", async (values, expected) => {
  for (const value of values) await telemetry.record(vital(value));
  expect(await telemetry.summary("owner", 30)).toMatchObject({
    ok: true,
    value: { vitals: [{ p75: expected, saved: values.length }] },
  });
});

it.each([
  [-0, 0, Number.MIN_VALUE, Number.MIN_VALUE * 2],
  [Number.MIN_VALUE, Number.MIN_VALUE * 2, Number.MIN_VALUE * 3],
  [1, 1 + Number.EPSILON, 1 + Number.EPSILON * 2, 1 + Number.EPSILON * 3],
  [1e300, 2e300, Number.MAX_VALUE],
  [0, Number.MAX_VALUE],
])(
  "matches PostgreSQL interpolation for finite edge values %j",
  async (...values) => {
    for (const value of values) {
      if (Object.is(value, -0)) {
        await database.prisma.$executeRaw`
        SELECT web_telemetry.record_vital(${instant},'/products/[slug]','mobile','LCP','-0'::float8)
      `;
      } else expect(await telemetry.record(vital(value))).toEqual({ ok: true });
    }
    const expected: unknown = await database.prisma.$queryRaw`
    SELECT percentile_cont(0.75) WITHIN GROUP (ORDER BY value) AS p75
    FROM web_telemetry.vital_samples
  `;
    const actual = await telemetry.summary("owner", 30);
    expect(actual.ok).toBe(true);
    if (!actual.ok) throw new Error(actual.error.code);
    expect(actual.value.vitals.map(({ p75 }) => ({ p75 }))).toEqual(expected);
  },
);

it.each([1, 7, 30])(
  "matches the full percentile query across groups, completed days and partial today (%i days)",
  async (days) => {
    const midnight = new Date(instant);
    midnight.setUTCHours(0, 0, 0, 0);
    const from = new Date(midnight);
    from.setUTCDate(from.getUTCDate() - days + 1);
    const times = [
      new Date(from.getTime() - 1),
      from,
      new Date(midnight.getTime() - 1),
      midnight,
      new Date(instant.getTime() - 1),
      instant,
      new Date(instant.getTime() + 1),
    ];
    for (const [index, at] of times.entries()) {
      const atTime = new WebTelemetry({
        prisma: database.prisma,
        clock: () => at,
        accounts: {
          checkPermission: () => Promise.resolve({ ok: true, allowed: true }),
        },
      });
      for (const mobile of [true, false]) {
        for (const route of ["/products/private", "/learn/private"]) {
          expect(
            await atTime.record({
              kind: "vitals",
              route,
              mobile,
              metrics: [
                { name: "LCP", value: index * 19 + 0.25 },
                { name: "INP", value: index * 7 + 0.5 },
                { name: "CLS", value: index / 10 },
              ],
            }),
          ).toEqual({ ok: true });
        }
      }
    }
    const expected: unknown = await database.prisma.$queryRaw(Prisma.sql`
      SELECT r.route_template,s.device_class,s.metric,
       percentile_cont(0.75) WITHIN GROUP (ORDER BY s.value) AS p75
      FROM web_telemetry.vital_samples s JOIN web_telemetry.route_templates r ON r.id=s.route_id
      WHERE s.occurred_at>=${from} AND s.occurred_at<=${instant}
      GROUP BY r.route_template,s.device_class,s.metric
      ORDER BY r.route_template,s.device_class,s.metric
    `);
    const actual = await telemetry.summary("owner", days);
    expect(actual.ok).toBe(true);
    if (!actual.ok) throw new Error(actual.error.code);
    expect(
      actual.value.vitals.map(
        ({ route_template, device_class, metric, p75 }) => ({
          route_template,
          device_class,
          metric,
          p75,
        }),
      ),
    ).toEqual(expected);
  },
);

it("requires the real platform admin permission and respects its revocation", async () => {
  const accounts = assembleAccounts({
    prisma: database.prisma,
    emailFingerprintKey: "telemetry-test-fingerprint-key-854",
  });
  const identity = { issuer: "https://telemetry.test/oidc", subject: "owner" };
  const { accountId } = await bootstrapOwnerAccount(
    database.prisma,
    identity,
    "materials:manage",
  );
  const actual = new WebTelemetry({
    prisma: database.prisma,
    accounts,
    clock: () => instant,
  });
  expect(await actual.summary(accountId, 7)).toEqual({
    ok: false,
    error: { code: "forbidden" },
  });
  await bootstrapOwnerAccount(database.prisma, identity, "platform:admin");
  expect(await actual.summary(accountId, 7)).toMatchObject({
    ok: true,
    value: { vitals: [], errors: [] },
  });
  await database.prisma.accountPermission.delete({
    where: {
      accountId_permission: { accountId, permission: "platform:admin" },
    },
  });
  expect(await actual.summary(accountId, 7)).toEqual({
    ok: false,
    error: { code: "forbidden" },
  });

  const server = new McpServer({ name: "telemetry-test", version: "1" });
  registerWebTelemetryTool(server, { accountId, telemetry: actual });
  const client = new Client({ name: "telemetry-test-client", version: "1" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const tool = (await client.listTools()).tools.find(
      ({ name }) => name === "web_telemetry_summary",
    );
    expect(tool?.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
    });
    expect(
      await client.callTool({
        name: "web_telemetry_summary",
        arguments: { days: 7 },
      }),
    ).toMatchObject({
      isError: true,
      structuredContent: { ok: false, error: { code: "forbidden" } },
    });
    await bootstrapOwnerAccount(database.prisma, identity, "platform:admin");
    expect(
      await client.callTool({
        name: "web_telemetry_summary",
        arguments: { days: 7 },
      }),
    ).toMatchObject({
      structuredContent: { ok: true, value: { vitals: [], errors: [] } },
    });
    expect(
      await client.callTool({
        name: "web_telemetry_summary",
        arguments: { days: 31 },
      }),
    ).toMatchObject({ isError: true });
  } finally {
    await client.close();
    await server.close();
  }
});
it("enforces the daily quota atomically and labels the late-day incomplete sample", async () => {
  await database.prisma
    .$executeRaw`INSERT INTO web_telemetry.daily_quota(day,kind,saved,dropped) VALUES ('2026-10-09','vitals',19995,0)`;
  await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      database.run(() => telemetry.record(vital(i))),
    ),
  );
  expect(await telemetry.summary("owner", 1)).toMatchObject({
    ok: true,
    value: { vitals: [{ saved: 5, dropped: 15, incomplete: true }] },
  });
});
it("groups client and server errors by digest and route and keeps 500 Unicode characters", async () => {
  for (const source of ["client", "server"])
    await telemetry.record({
      kind: "error",
      source,
      route: "/materials/secret",
      mobile: false,
      digest: "42",
      name: "Error",
      message: "😀".repeat(501),
    });
  expect(await telemetry.summary("owner", 1)).toMatchObject({
    ok: true,
    value: {
      errors: [{ digest: "42", route_template: "/materials/[slug]", count: 2 }],
    },
  });
  const rows: unknown = await database.prisma
    .$queryRaw`SELECT char_length(message) AS length, octet_length(message) AS bytes FROM web_telemetry.errors`;
  expect(rows).toEqual([
    { length: 500, bytes: 2000 },
    { length: 500, bytes: 2000 },
  ]);
});
it("cleans data older than 30 days in bounded batches", async () => {
  await telemetry.record(vital(100));
  expect(await telemetry.clean(new Date("2026-11-10T00:00:00Z"))).toMatchObject(
    { removed: 3 },
  );
  expect(await telemetry.summary("owner", 30)).toMatchObject({
    ok: true,
    value: { vitals: [], errors: [] },
  });
});

it("retention drains more than one batch and keeps samples exactly at the cutoff", async () => {
  await database.prisma
    .$executeRaw`SELECT web_telemetry.record_vital('2026-10-08T12:00:00Z', '/', 'desktop', 'LCP', 10) FROM generate_series(1,5001)`;
  await telemetry.record(vital(100));
  expect(await telemetry.clean(new Date("2026-11-08T12:00:00Z"))).toMatchObject(
    { ok: true, removed: 5003 },
  );
  expect(await telemetry.summary("owner", 1)).toMatchObject({
    ok: true,
    value: { vitals: [{ p75: 100, saved: 1, dropped: 0 }] },
  });
  expect(await telemetry.clean(new Date("2026-11-08T12:00:00Z"))).toMatchObject(
    { ok: true, removed: 0 },
  );
});

it("accepts the private API report and rejects visitor fields at the HTTP boundary", async () => {
  const app = await createApiApplication(
    parsePlatformConfig({ NODE_ENV: "test", DATABASE_URL: database.url }),
    { logger: false },
  );
  try {
    await app.init();
    const accepted = await app.inject({
      method: "POST",
      url: "/internal/web-telemetry",
      payload: vital(123),
    });
    expect(accepted.statusCode).toBe(204);
    const rejected = await app.inject({
      method: "POST",
      url: "/internal/web-telemetry",
      payload: { ...vital(456), accountId: "private" },
    });
    expect(rejected.statusCode).toBe(400);
    // Live HTTP adapter owns its clock; the 30-day read spans an adjacent UTC midnight too.
    expect(
      await app.get(WebTelemetry).summary("invalid-account", 30),
    ).toMatchObject({ ok: false });
    const rows: unknown = await database.prisma
      .$queryRaw`SELECT r.route_template,v.device_class,v.value FROM web_telemetry.vital_samples v JOIN web_telemetry.route_templates r ON r.id=v.route_id`;
    expect(rows).toEqual([
      {
        route_template: "/products/[slug]",
        device_class: "mobile",
        value: 123,
      },
    ]);
  } finally {
    await app.close();
  }
});
it("evaluates watchdog SQL against its database clock and clears aged signals", async () => {
  // Database-clock adapter contract: both the fixture and view use SQL now(), away from each window edge.
  await database.prisma
    .$executeRaw`INSERT INTO web_telemetry.errors SELECT now()-interval '1 minute','server','new','/','Error','failed' FROM generate_series(1,10)`;
  const failed: unknown = await database.prisma
    .$queryRaw`SELECT name,value FROM web_telemetry.health`;
  expect(failed).toEqual(
    expect.arrayContaining([
      { name: "web_telemetry_growth", value: 1n },
      { name: "web_telemetry_digest", value: 1n },
    ]),
  );
  await database.prisma
    .$executeRaw`UPDATE web_telemetry.errors SET occurred_at=now()-interval '11 minutes'`;
  const recovered: unknown = await database.prisma
    .$queryRaw`SELECT name,value FROM web_telemetry.health`;
  expect(recovered).toEqual(
    expect.arrayContaining([
      { name: "web_telemetry_growth", value: 0n },
      { name: "web_telemetry_digest", value: 0n },
    ]),
  );
});

it("retains dropped-only coverage and admits the next UTC day", async () => {
  await database.prisma
    .$executeRaw`INSERT INTO web_telemetry.daily_quota(day,kind,saved,dropped) VALUES ('2026-10-09','vitals',20000,0)`;
  await telemetry.record(vital(999));
  expect(await telemetry.summary("owner", 1)).toMatchObject({
    ok: true,
    value: { vitals: [{ p75: null, saved: 0, dropped: 1, incomplete: true }] },
  });
  const nextDay = new WebTelemetry({
    prisma: database.prisma,
    accounts: {
      checkPermission: () => Promise.resolve({ ok: true, allowed: true }),
    },
    clock: () => new Date("2026-10-10T00:00:00Z"),
  });
  await nextDay.record(vital(100));
  expect(await nextDay.summary("owner", 1)).toMatchObject({
    ok: true,
    value: { vitals: [{ p75: 100, saved: 1, dropped: 0, incomplete: false }] },
  });
});

it("enforces the error quota under concurrent recording", async () => {
  await database.prisma
    .$executeRaw`INSERT INTO web_telemetry.daily_quota(day,kind,saved,dropped) VALUES ('2026-10-09','error',4995,0)`;
  await Promise.all(
    Array.from({ length: 20 }, () =>
      database.run(() =>
        telemetry.record({
          kind: "error",
          source: "client",
          route: "/account",
          mobile: true,
          digest: "42",
          name: "Error",
          message: "failed",
        }),
      ),
    ),
  );
  expect(await telemetry.summary("owner", 1)).toMatchObject({
    ok: true,
    value: { errors: [{ count: 5 }], coverage: [{ saved: 5, dropped: 15 }] },
  });
});

it("uses UTC quota days even when the database connection has another timezone", async () => {
  await telemetry.record(vital(10));
  const url = new URL(database.url);
  url.searchParams.set("options", "-c timezone=America/Los_Angeles");
  const prisma = createPrismaClient(url.toString());
  const nextDay = new WebTelemetry({
    prisma,
    accounts: {
      checkPermission: () => Promise.resolve({ ok: true, allowed: true }),
    },
    clock: () => new Date("2026-10-10T00:00:00Z"),
  });
  try {
    expect(
      await prisma.$queryRaw`SELECT current_setting('TimeZone') AS timezone`,
    ).toEqual([{ timezone: "America/Los_Angeles" }]);
    await nextDay.record(vital(20));
    expect(await nextDay.summary("owner", 1)).toMatchObject({
      ok: true,
      value: { vitals: [{ saved: 1, p75: 20 }], coverage: [{ saved: 1 }] },
    });
  } finally {
    await prisma.$disconnect();
  }
});
