import type { Database } from "../../database/database.js";
import { groupedCounts } from "../../database/diagnostic-counts.js";

export function botContactStateCounts(database: Database) {
  return groupedCounts(database, "bot_contacts", "contactability");
}

export async function probeBotContactStorage(database: {
  query(sql: string): Promise<unknown>;
}): Promise<void> {
  await database.query("select count(*) from bot_contacts where false");
}
