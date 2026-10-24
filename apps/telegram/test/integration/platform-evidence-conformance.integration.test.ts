import { registerFixedClock } from "../support/fixed-clock.js";
import { hasText } from "../../src/shared/text.js";
import { sql } from "kysely";
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { withMigrationDatabase } from "../support/migration-database.js";

import type { Database } from "../../src/database/database.js";
import { migrateTo, migrateToLatest } from "../../src/database/migrator.js";

registerFixedClock();

const databaseUrl = process.env["DATABASE_URL"];
if (!hasText(databaseUrl)) {
  throw new Error("DATABASE_URL is required for integration tests");
}

describe("Platform evidence conformance migration", () => {
  it("backfills every historical producer source and enforces the vocabulary", async ({
    signal,
  }) => {
    await withMigrationDatabase(
      databaseUrl,
      `evidence_history_${randomUUID().replaceAll("-", "")}`,
      async (database) => {
        try {
          await migrateTo(database, "005-membership-reconciliation");
          const sourceColumnBefore = await sourceColumnExists(database);
          expect(sourceColumnBefore).toBe(false);

          await seedHistoricalDeliveries(database);
          await migrateToLatest(database);

          const deliveries = await database
            .selectFrom("membership_evidence_outbox")
            .select(["result_ref", "source"])
            .orderBy("result_ref")
            .execute();
          expect(deliveries).toEqual([
            { result_ref: "initial-link:1", source: "link_time" },
            {
              result_ref: "membership-event:inside:1",
              source: "member_status_event",
            },
            {
              result_ref: "reconciliation:identity-ref:1",
              source: "reconciliation",
            },
          ]);
          await expect(
            sql`
          update membership_evidence_outbox
          set source = 'untrusted'
          where result_ref = 'initial-link:1'
        `.execute(database),
          ).rejects.toThrow();
        } finally {
          await migrateToLatest(database);
        }
      },
      { signal },
    );
  });
});

async function sourceColumnExists(database: Database): Promise<boolean> {
  const result = await sql<{ exists: boolean }>`
    select exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'membership_evidence_outbox'
        and column_name = 'source'
    ) as exists
  `.execute(database);
  return result.rows[0]?.exists ?? false;
}

async function seedHistoricalDeliveries(database: Database): Promise<void> {
  await sql`
    insert into link_transactions (
      link_transaction_ref,
      account_ref,
      token_digest,
      return_correlation,
      expires_at,
      state,
      bot_identity,
      candidate_telegram_user_id,
      registered_at,
      received_at,
      confirmed_at
    ) values (
      'link-ref',
      'account-ref',
      'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      'return-ref',
      '2030-01-01T01:00:00.000Z',
      'linked',
      'inside',
      42,
      '2030-01-01T00:00:00.000Z',
      '2030-01-01T00:00:00.000Z',
      '2030-01-01T00:00:00.000Z'
    );
    insert into platform_links (
      telegram_identity_ref,
      bot_identity,
      telegram_user_id,
      account_ref,
      link_transaction_ref,
      linked_at
    ) values (
      'identity-ref',
      'inside',
      42,
      'account-ref',
      'link-ref',
      '2030-01-01T00:00:00.000Z'
    );
    insert into membership_check_results (
      result_ref,
      telegram_identity_ref,
      normalized_state,
      evidence_ref,
      evidence_version,
      observed_at
    ) values
      ('initial-link:1', 'identity-ref', 'member', 'evidence-1', 1, '2030-01-01T00:00:00.000Z'),
      ('membership-event:inside:1', 'identity-ref', 'non_member', 'evidence-2', 2, '2030-01-01T00:01:00.000Z'),
      ('reconciliation:identity-ref:1', 'identity-ref', 'member', 'evidence-3', 3, '2030-01-01T00:02:00.000Z');
    insert into membership_evidence_outbox (
      id,
      result_ref,
      envelope,
      state,
      attempt_count,
      available_at,
      updated_at
    ) values
      ('delivery-1', 'initial-link:1', '{}', 'pending', 0, '2030-01-01T00:00:00.000Z', '2030-01-01T00:00:00.000Z'),
      ('delivery-2', 'membership-event:inside:1', '{}', 'pending', 0, '2030-01-01T00:01:00.000Z', '2030-01-01T00:01:00.000Z'),
      ('delivery-3', 'reconciliation:identity-ref:1', '{}', 'pending', 0, '2030-01-01T00:02:00.000Z', '2030-01-01T00:02:00.000Z')
  `.execute(database);
}
