import type { Database, DatabaseSchema } from "../../database/database.js";
import type { Transaction } from "kysely";

type Executor = Database | Transaction<DatabaseSchema>;

/** A composable read owned by Bot Contacts; the caller keeps its snapshot and joins. */
export function botContactRows(database: Executor) {
  return database.selectFrom("bot_contacts").selectAll();
}

export async function findBotContact(
  database: Executor,
  bot: string,
  user: string,
  lock = false,
) {
  let query = botContactRows(database)
    .where("bot_identity", "=", bot)
    .where("telegram_user_id", "=", user);
  if (lock) query = query.forUpdate();
  return query.executeTakeFirst();
}

/** Caller holds the contact lock; a newer observation supersedes this transport result. */
export async function blockBotContact(
  tx: Transaction<DatabaseSchema>,
  bot: string,
  user: string,
  now: Date,
  startedAt: Date,
  updateAvailability: () => Promise<void>,
): Promise<void> {
  const contact = await findBotContact(tx, bot, user);
  if (!contact || contact.updated_at.getTime() > startedAt.getTime()) return;
  await updateAvailability();
  await tx
    .updateTable("bot_contacts")
    .set({ contactability: "blocked", updated_at: now })
    .where("bot_identity", "=", bot)
    .where("telegram_user_id", "=", user)
    .execute();
}
