import { sql } from "kysely";
import type { Database } from "../../database/database.js";
import { groupedCounts } from "../../database/diagnostic-counts.js";

export function updateDiagnosticCounts(database: Database) {
  return groupedCounts(database, "telegram_updates", "state");
}

export async function countInboxUpdate(
  database: Database,
  bot: string,
  update: string,
): Promise<number> {
  const row = await database
    .selectFrom("telegram_updates")
    .select(({ fn }) => fn.countAll().as("count"))
    .where("bot_identity", "=", bot)
    .where("update_id", "=", update)
    .executeTakeFirstOrThrow();
  return Number(row.count);
}

export async function retryMarkerInboxItems(
  database: Database,
  retryMarker: string,
): Promise<number> {
  const result = await sql<{ count: string }>`
    select count(*)::text as count
    from telegram_updates
    where payload #>> '{message,text}' = ${retryMarker}
  `.execute(database);
  return Number(result.rows[0]?.count ?? 0);
}
