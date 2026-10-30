import { sql, type Kysely } from "kysely";
import type { Migration } from "kysely/migration";

/** Nullable so existing receipts retain their original absence of a carrier. */
export const waitlistReceiptTracingMigration: Migration = {
  async up(db: Kysely<unknown>) {
    await sql`alter table waitlist_confirmations add column receipt_traceparent varchar(55) null`.execute(db);
  },
  async down(db: Kysely<unknown>) {
    await sql`alter table waitlist_confirmations drop column receipt_traceparent`.execute(db);
  },
};
