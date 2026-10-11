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
