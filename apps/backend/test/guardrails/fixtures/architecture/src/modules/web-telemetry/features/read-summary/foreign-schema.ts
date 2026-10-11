declare const Prisma: {
  sql(parts: TemplateStringsArray, ...values: unknown[]): unknown;
};
declare const tableIdentifier: string;

Prisma.sql`
  WITH counts AS MATERIALIZED (
    SELECT count(*) FROM materials.published_materials
  ) SELECT * FROM counts
`;
Prisma.sql`
  WITH samples AS NOT MATERIALIZED (
    SELECT value FROM web_telemetry.vital_samples
  ) SELECT * FROM undeclared_samples
`;
Prisma.sql`
  WITH samples AS (
    SELECT value FROM web_telemetry.vital_samples
  ) SELECT * FROM samples
  LEFT JOIN LATERAL (SELECT * FROM accounts.accounts) foreign_sample ON true
`;
Prisma.sql`SELECT * FROM web_telemetry.vital_samples
  LEFT JOIN LATERAL ${tableIdentifier} foreign_sample ON true`;
Prisma.sql`SELECT * FROM outside_samples WHERE EXISTS (
  WITH outside_samples AS (SELECT value FROM web_telemetry.vital_samples)
  SELECT * FROM outside_samples
)`;
Prisma.sql`WITH self_samples AS (SELECT * FROM self_samples)
  SELECT * FROM self_samples`;
Prisma.sql`WITH eager_samples AS (SELECT * FROM later_samples),
  later_samples AS (SELECT value FROM web_telemetry.vital_samples)
  SELECT * FROM eager_samples`;
Prisma.sql`WITH first_samples AS (SELECT value FROM web_telemetry.vital_samples)
  SELECT * FROM first_samples; SELECT * FROM first_samples`;
Prisma.sql`-- WITH comment_samples AS (SELECT value FROM web_telemetry.vital_samples)
  SELECT * FROM comment_samples`;
Prisma.sql`WITH quoted_self_samples AS (SELECT ")" FROM quoted_self_samples)
  SELECT * FROM quoted_self_samples`;
Prisma.sql`WITH escaped_self_samples AS (SELECT E'\\')' FROM escaped_self_samples)
  SELECT * FROM escaped_self_samples`;
Prisma.sql`/* outer /* nested */ WITH comment_scope AS (SELECT value FROM web_telemetry.vital_samples) */
  SELECT * FROM comment_scope`;
Prisma.sql`WITH "UPPER_SAMPLES" AS (SELECT value FROM web_telemetry.vital_samples)
  SELECT * FROM UPPER_SAMPLES`;
