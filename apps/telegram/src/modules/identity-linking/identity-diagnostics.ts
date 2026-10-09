import { sql } from "kysely";
import type { Database } from "../../database/database.js";
import { groupedCounts } from "../../database/diagnostic-counts.js";

export async function identityDiagnosticSnapshot(database: Database) {
  const [transactions, events, recoveries] = await Promise.all([
    groupedCounts(database, "link_transactions", "state"),
    groupedCounts(database, "identity_link_events", "event_type"),
    sql<{
      count: string;
    }>`select count(*)::text as count from identity_link_recoveries`.execute(
      database,
    ),
  ]);
  return {
    linkTransactionsByState: transactions,
    identityLinkEventsByType: events,
    ownerRecoveries: Number(recoveries.rows[0]?.count ?? 0),
  };
}

export async function probeIdentityStorage(database: {
  query(sql: string): Promise<unknown>;
}): Promise<void> {
  await database.query(
    "select count(*) from identity_link_recoveries where false",
  );
}
