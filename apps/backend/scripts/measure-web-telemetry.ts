import { performance } from "node:perf_hooks";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { z } from "zod";
import {
  createPrismaClient,
  Prisma,
} from "../src/infrastructure/prisma/index.js";
import { migrateToLatest } from "../src/migrations/index.js";
import { WebTelemetry } from "../src/modules/web-telemetry/index.js";

const budgetBytes = 600_000_000;
const cycles = 8;
const corpusSize = 1_024;
const metricsPerDay = 20_000;
const errorsPerDay = 5_000;
const millisecondsPerDay = 86_400_000;

async function measure() {
  const container = await new PostgreSqlContainer("postgres:18.4-alpine")
    .withResourcesQuota({ cpu: 2, memory: 1 })
    .start();
  const prisma = createPrismaClient(container.getConnectionUri());
  try {
    await migrateToLatest(container.getConnectionUri());
    let random = 707;
    const messages = Array.from({ length: corpusSize }, () =>
      Array.from({ length: 500 }, () => {
        random ^= random << 13;
        random ^= random >>> 17;
        random ^= random << 5;
        return String.fromCodePoint(0x1f300 + ((random >>> 0) % 0x800));
      }).join(""),
    );
    const corpus = JSON.stringify(messages);
    const from = new Date("2026-09-10T00:00:00Z");
    let now = new Date("2026-10-09T23:59:59Z");
    const queryTimes: number[] = [];
    const measuredPrisma = prisma.$extends({
      query: {
        async $queryRaw({ args, query }) {
          const start = performance.now();
          const result: unknown = await query(args);
          queryTimes.push(performance.now() - start);
          return result;
        },
      },
    });
    const telemetry = new WebTelemetry({
      prisma: measuredPrisma,
      clock: () => now,
      accounts: {
        checkPermission: () => Promise.resolve({ ok: true, allowed: true }),
      },
    });

    async function seed(start: Date, days: number) {
      await prisma.$executeRaw(Prisma.sql`
        INSERT INTO web_telemetry.vital_samples
        SELECT ${start}::timestamptz + (i/${metricsPerDay})*interval '1 day' + (i%${metricsPerDay})*interval '4 seconds',
         '/authoring/materials/[materialId]/preview', CASE WHEN i%2=0 THEN 'mobile' ELSE 'desktop' END,
         (ARRAY['LCP','INP','CLS'])[1+i%3], (i%1000)::float8
        FROM generate_series(0,${days * metricsPerDay - 1}::int) i
      `);
      await prisma.$executeRaw(Prisma.sql`
        INSERT INTO web_telemetry.errors
        SELECT ${start}::timestamptz + (i/${errorsPerDay})*interval '1 day' + (i%${errorsPerDay})*interval '16 seconds',
         CASE WHEN i%2=0 THEN 'client' ELSE 'server' END, md5(i::text || ${start.toISOString()}),
         '/authoring/materials/[materialId]/preview','Error', c.message
        FROM generate_series(0,${days * errorsPerDay - 1}::int) i
        JOIN jsonb_array_elements_text(${corpus}::jsonb) WITH ORDINALITY c(message,n) ON c.n=1+i%${corpusSize}
      `);
      await prisma.$executeRaw(Prisma.sql`
        INSERT INTO web_telemetry.daily_quota(day,kind,saved,dropped)
        SELECT (${start}::timestamptz AT TIME ZONE 'UTC')::date+i,'vitals',20000,0 FROM generate_series(0,${days - 1}::int) i
        UNION ALL SELECT (${start}::timestamptz AT TIME ZONE 'UTC')::date+i,'error',5000,0 FROM generate_series(0,${days - 1}::int) i
      `);
      await prisma.$executeRaw(Prisma.sql`
        INSERT INTO web_telemetry.coverage
        SELECT (occurred_at AT TIME ZONE 'UTC')::date,'vitals',route_template,device_class,metric,count(*)::int,0
        FROM web_telemetry.vital_samples WHERE occurred_at>=${start} GROUP BY 1,route_template,device_class,metric
        UNION ALL
        SELECT (occurred_at AT TIME ZONE 'UTC')::date,'error',route_template,'desktop','',count(*)::int,0
        FROM web_telemetry.errors WHERE occurred_at>=${start} GROUP BY 1,route_template
      `);
    }
    async function size() {
      const rows: unknown = await prisma.$queryRaw(Prisma.sql`
        SELECT sum(pg_total_relation_size(c.oid))::float8 AS bytes FROM pg_class c
        JOIN pg_namespace n ON c.relnamespace=n.oid WHERE n.nspname='web_telemetry' AND c.relkind IN ('r','m')
      `);
      const [row] = z
        .array(z.object({ bytes: z.number() }))
        .length(1)
        .parse(rows);
      if (row === undefined) throw new Error("Missing schema size");
      return row.bytes;
    }
    await seed(from, 30);
    await prisma.$executeRaw`ANALYZE web_telemetry.vital_samples`;
    await prisma.$executeRaw`ANALYZE web_telemetry.errors`;
    const initialBytes = await size();
    const relations: unknown =
      await prisma.$queryRaw`SELECT c.relname,pg_total_relation_size(c.oid)::float8 AS bytes FROM pg_class c JOIN pg_namespace n ON c.relnamespace=n.oid WHERE n.nspname='web_telemetry' AND c.relkind='r'`;
    // Initialize the extended Prisma connection without reading or warming telemetry data.
    await measuredPrisma.$queryRaw`SELECT 1`;
    queryTimes.length = 0;
    const summaryTimes: number[] = [];
    for (let run = 0; run < 8; run++) {
      const start = performance.now();
      const summary = await telemetry.summary("benchmark-owner", 30);
      if (!summary.ok) throw new Error(summary.error.code);
      summaryTimes.push(performance.now() - start);
    }
    // Each summary issues p75, error groups and coverage in this order.
    const p75Times = queryTimes.filter((_, index) => index % 3 === 0);
    const growth: {
      cycle: number;
      beforeCleanupBytes: number;
      afterCleanupBytes: number;
      afterVacuumBytes: number;
      cleanupMs: number;
    }[] = [];
    for (let cycle = 1; cycle <= cycles; cycle++) {
      now = new Date(now.getTime() + millisecondsPerDay);
      const start = new Date(now);
      start.setUTCHours(0, 0, 0, 0);
      await seed(start, 1);
      const beforeCleanupBytes = await size();
      const before = performance.now();
      const cleaned = await telemetry.clean(now);
      const cleanupMs = performance.now() - before;
      if (!cleaned.ok) throw new Error(cleaned.error.code);
      const afterCleanupBytes = await size();
      // Ordinary vacuum models daily autovacuum; it does not shrink heap/index files or reset bloat.
      await prisma.$executeRaw`VACUUM (ANALYZE) web_telemetry.vital_samples`;
      await prisma.$executeRaw`VACUUM (ANALYZE) web_telemetry.errors`;
      await prisma.$executeRaw`VACUUM (ANALYZE) web_telemetry.coverage`;
      await prisma.$executeRaw`VACUUM (ANALYZE) web_telemetry.daily_quota`;
      growth.push({
        cycle,
        beforeCleanupBytes,
        afterCleanupBytes,
        afterVacuumBytes: await size(),
        cleanupMs,
      });
    }
    const maxBytes = Math.max(
      initialBytes,
      ...growth.flatMap((row) => [
        row.beforeCleanupBytes,
        row.afterCleanupBytes,
        row.afterVacuumBytes,
      ]),
    );
    const result = {
      postgres: "18.4",
      cpuLimit: 2,
      budgetBytes,
      initialBytes,
      relations,
      maxBytes,
      p75TimesMs: p75Times,
      fullSummaryTimesMs: summaryTimes,
      growth,
    };
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    if (
      maxBytes > budgetBytes ||
      Math.max(...p75Times) > 200 ||
      growth.some((row) => row.cleanupMs > 5000)
    )
      throw new Error("Telemetry resource budget exceeded");
  } finally {
    await prisma.$disconnect();
    await container.stop();
  }
}
await measure();
