import { z } from "zod";
import {
  Prisma,
  type WebTelemetryPrisma,
} from "../../../../infrastructure/prisma/index.js";

const vitalRows = z.array(
  z.object({
    route_template: z.string(),
    device_class: z.enum(["mobile", "desktop"]),
    metric: z.string(),
    p75: z.number().nullable(),
    saved: z.number(),
    dropped: z.number(),
    incomplete: z.boolean(),
  }),
);

const errorRows = z.array(
  z.object({
    digest: z.string(),
    route_template: z.string(),
    count: z.number(),
    client_count: z.number(),
    server_count: z.number(),
  }),
);
const coverageRows = z.array(
  z.object({
    kind: z.enum(["vitals", "error"]),
    route_template: z.string(),
    device_class: z.enum(["mobile", "desktop"]),
    metric: z.string(),
    saved: z.number(),
    dropped: z.number(),
  }),
);

export async function readSummary(
  prisma: WebTelemetryPrisma,
  from: Date,
  now: Date,
) {
  const rows: unknown = await prisma.$queryRaw(Prisma.sql`
    SELECT c.route_template,c.device_class,c.metric,p.p75,c.saved,c.dropped,c.dropped>0 AS incomplete
    FROM (
      SELECT route_template, device_class, metric, sum(saved)::float8 AS saved, sum(dropped)::float8 AS dropped
      FROM web_telemetry.coverage
      WHERE kind='vitals' AND day>=${from}::date AND day<=${now}::date AND metric IN ('LCP','INP','CLS')
      GROUP BY route_template, device_class, metric
    ) c LEFT JOIN (
      SELECT route_template, device_class, metric,
       percentile_cont(0.75) WITHIN GROUP (ORDER BY value) AS p75
      FROM web_telemetry.vital_samples
      WHERE occurred_at >= ${from} AND occurred_at <= ${now} AND metric IN ('LCP','INP','CLS')
      GROUP BY route_template, device_class, metric
    ) p USING(route_template,device_class,metric)
    ORDER BY c.route_template,c.device_class,c.metric
  `);
  const errors: unknown = await prisma.$queryRaw(Prisma.sql`
    SELECT digest,route_template,count(*)::int AS count,
     count(*) FILTER (WHERE source='client')::int AS client_count,
     count(*) FILTER (WHERE source='server')::int AS server_count
    FROM web_telemetry.errors WHERE occurred_at>=${from} AND occurred_at<=${now}
    GROUP BY digest,route_template ORDER BY count(*) DESC,digest,route_template LIMIT 100
  `);
  const coverage: unknown = await prisma.$queryRaw(Prisma.sql`
    SELECT kind,route_template,device_class,metric,sum(saved)::float8 AS saved,sum(dropped)::float8 AS dropped
    FROM web_telemetry.coverage WHERE day>=${from}::date AND day<=${now}::date
    GROUP BY kind,route_template,device_class,metric ORDER BY kind,route_template,device_class,metric
  `);
  return {
    from: from.toISOString(),
    to: now.toISOString(),
    vitals: vitalRows.parse(rows),
    errors: errorRows.parse(errors),
    coverage: coverageRows.parse(coverage),
  };
}
