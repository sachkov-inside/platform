declare const Prisma: { sql(parts: TemplateStringsArray): unknown };

export const summaryQuery = Prisma.sql`
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
export const recursiveQuery = Prisma.sql`
  WITH RECURSIVE recursive_samples(value) AS (
    SELECT value FROM web_telemetry.vital_samples
    UNION ALL SELECT value FROM recursive_samples WHERE value<0
  ) SELECT value FROM recursive_samples
`;
export const quotedQuery = Prisma.sql`
  WITH quoted_samples AS (
    SELECT '('::text AS marker FROM web_telemetry.vital_samples
  ), values_with_comment AS (
    -- Parentheses in comments do not close the CTE body: )
    SELECT marker FROM quoted_samples
  ) SELECT marker FROM values_with_comment
`;
export const quotedCteQuery = Prisma.sql`
  WITH "quoted_keys" AS (
    SELECT value FROM web_telemetry.vital_samples
  ) SELECT value FROM "quoted_keys"
`;
export const foldedCteQuery = Prisma.sql`
  WITH UPPER_KEYS AS (
    SELECT value FROM WEB_TELEMETRY.VITAL_SAMPLES
  ) SELECT value FROM upper_keys
`;
