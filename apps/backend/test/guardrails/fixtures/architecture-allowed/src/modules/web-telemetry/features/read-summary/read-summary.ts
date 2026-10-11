declare const Prisma: { sql(parts: TemplateStringsArray): unknown };

Prisma.sql`
  WITH counts AS MATERIALIZED (
    SELECT count(*) AS saved FROM web_telemetry.coverage
  ), samples AS NOT MATERIALIZED (
    SELECT value FROM web_telemetry.vital_samples
  ), ordinary AS (
    SELECT value FROM samples
  )
  SELECT selected.value FROM counts
  CROSS JOIN LATERAL (SELECT value FROM ordinary LIMIT 2) selected
`;
