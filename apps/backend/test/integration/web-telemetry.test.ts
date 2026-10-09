import { createApiApplication } from "../../src/entrypoints/api/create-api-application.js";
import { parsePlatformConfig } from "../../src/config/platform-config.js";
import { afterEach, beforeEach, expect, it } from "vitest";
import { WebTelemetry } from "../../src/modules/web-telemetry/index.js";
import {
  createMigratedTestDatabase,
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
      .$queryRaw`SELECT route_template,device_class,value FROM web_telemetry.vital_samples`;
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
