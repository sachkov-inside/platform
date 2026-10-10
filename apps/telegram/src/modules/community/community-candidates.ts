import type { Database, DatabaseSchema } from "../../database/database.js";
import type { Transaction } from "kysely";

export function communityBindingUsers(
  database: Database | Transaction<DatabaseSchema>,
  bot: string,
) {
  return database
    .selectFrom("community_bindings")
    .select("telegram_user_id")
    .where("bot_identity", "=", bot)
    .where("telegram_user_id", "is not", null)
    .execute();
}
