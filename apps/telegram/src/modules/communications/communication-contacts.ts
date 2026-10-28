import { sql, type Transaction } from "kysely";
import type { Database, DatabaseSchema } from "../../database/database.js";

export async function ensureCommunicationContact(
  tx: Transaction<DatabaseSchema>,
  bot: string,
  user: string,
): Promise<void> {
  await sql`insert into communication_contacts(contact_id,bot_identity,telegram_user_id)
    values(gen_random_uuid(),${bot},${user})
    on conflict(bot_identity,telegram_user_id) do nothing`.execute(tx);
}

export async function findCommunicationContact(
  tx: Transaction<DatabaseSchema>,
  bot: string,
  user: string,
) {
  return tx
    .selectFrom("communication_contacts")
    .select("contact_id")
    .where("bot_identity", "=", bot)
    .where("telegram_user_id", "=", user)
    .executeTakeFirst();
}

/** Marketing preference of each known contact: `false` after `/stop` until `/resume`. */
export async function marketingPreferences(
  database: Database | Transaction<DatabaseSchema>,
  bot: string,
  users: readonly string[],
): Promise<ReadonlyMap<string, boolean>> {
  const preferences = new Map<string, boolean>();
  const unique = [...new Set(users)];
  for (let index = 0; index < unique.length; index += 100) {
    const rows = await database
      .selectFrom("communication_contacts")
      .select(["telegram_user_id", "marketing_enabled"])
      .where("bot_identity", "=", bot)
      .where("telegram_user_id", "in", unique.slice(index, index + 100))
      .execute();
    for (const row of rows)
      preferences.set(row.telegram_user_id, row.marketing_enabled);
  }
  return preferences;
}
