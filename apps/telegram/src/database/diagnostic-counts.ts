import { sql } from "kysely";
import type { Database } from "./database.js";

export async function groupedNonNullCounts(
  database: Database,
  table: string,
  column: string,
): Promise<Record<string, number>> {
  const result = await sql<{ count: string; key: string }>`
    select ${sql.ref(column)}::text as key, count(*)::text as count
    from ${sql.table(table)}
    where ${sql.ref(column)} is not null
    group by ${sql.ref(column)}
    order by ${sql.ref(column)}
  `.execute(database);
  return Object.fromEntries(
    result.rows.map((row) => [row.key, Number(row.count)]),
  );
}

export async function groupedCounts(
  database: Database,
  table: string,
  column: string,
): Promise<Record<string, number>> {
  const result = await sql<{ count: string; key: string }>`
    select ${sql.ref(column)}::text as key, count(*)::text as count
    from ${sql.table(table)}
    group by ${sql.ref(column)}
    order by ${sql.ref(column)}
  `.execute(database);
  return Object.fromEntries(
    result.rows.map((row) => [row.key, Number(row.count)]),
  );
}
