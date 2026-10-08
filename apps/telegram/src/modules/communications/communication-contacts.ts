import { sql, type Transaction } from "kysely";
import type { DatabaseSchema } from "../../database/database.js";

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
