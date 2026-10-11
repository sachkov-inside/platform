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
  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);
  // Completed UTC days have exact atomic coverage counts. Count today's bounded samples
  // in the same snapshot, since coverage can also include records later than this request.
  // The value index selects only the upper-quarter tail and its exact rank neighbours;
  // PostgreSQL still performs the same continuous interpolation, including ties/singletons.
  // Keep both UNION inputs explicitly ordered so the planner can merge them without
  // sorting the entire retained corpus before applying the rank offset.
  const rows: unknown = await prisma.$queryRaw(Prisma.sql`
    WITH counts AS MATERIALIZED (
      SELECT route_template,device_class,metric,sum(saved)::float8 AS saved,sum(dropped)::float8 AS dropped,
       coalesce(sum(saved) FILTER (WHERE day < ${today}::date),0)::bigint AS completed_saved
      FROM web_telemetry.coverage
      WHERE kind='vitals' AND day>=${from}::date AND day<=${now}::date AND metric IN ('LCP','INP','CLS')
      GROUP BY route_template,device_class,metric
    ), current_samples AS MATERIALIZED (
      SELECT route_id,device_class,metric,value_key
      FROM web_telemetry.vital_samples
      WHERE occurred_at>=${today} AND occurred_at<=${now} AND metric IN ('LCP','INP','CLS')
    ), current_day AS MATERIALIZED (
      SELECT route_id,device_class,metric,count(*)::bigint AS saved
      FROM current_samples
      GROUP BY route_id,device_class,metric
    )
    SELECT c.route_template,c.device_class,c.metric,p.p75,c.saved,c.dropped,c.dropped>0 AS incomplete
    FROM counts c
    LEFT JOIN web_telemetry.route_templates r ON r.route_template=c.route_template
    LEFT JOIN current_day d ON d.route_id=r.id AND d.device_class=c.device_class AND d.metric=c.metric
    CROSS JOIN LATERAL (SELECT c.completed_saved+coalesce(d.saved,0) AS samples) n
    CROSS JOIN LATERAL (SELECT (0.75*(n.samples-1))::float8 AS rank) ranked
    LEFT JOIN LATERAL (
      SELECT percentile_cont(ranked.rank-floor(ranked.rank)) WITHIN GROUP (ORDER BY original.value) AS p75
      FROM (
        SELECT value_key FROM (
          (SELECT value_key FROM web_telemetry.vital_samples
          WHERE route_id=r.id AND device_class=c.device_class AND metric=c.metric
           AND sample_day>=${from}::date AND sample_day<${today}::date
          ORDER BY value_key DESC)
          UNION ALL
          (SELECT value_key FROM current_samples
          WHERE route_id=r.id AND device_class=c.device_class AND metric=c.metric
          ORDER BY value_key DESC)
        ) window_samples
        ORDER BY value_key DESC
        OFFSET greatest(0,n.samples-1-ceil(ranked.rank))::bigint
        LIMIT CASE WHEN n.samples=0 THEN 0 WHEN ranked.rank=floor(ranked.rank) THEN 1 ELSE 2 END
      ) neighbours
      CROSS JOIN LATERAL (
        SELECT value FROM web_telemetry.vital_samples
        WHERE route_id=r.id AND device_class=c.device_class AND metric=c.metric
         AND value_key=neighbours.value_key
         AND sample_day>=${from}::date AND sample_day<=${today}::date
         AND occurred_at>=${from} AND occurred_at<=${now}
        LIMIT 1
      ) original
    ) p ON true
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
