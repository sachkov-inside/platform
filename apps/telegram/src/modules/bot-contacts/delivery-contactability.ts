import type { Transaction } from "kysely";
import type { DatabaseSchema } from "../../database/database.js";
import { contactLock } from "../communications/communication-state.js";
import { updateMarketingAvailability } from "../communications/marketing-preferences.js";

/** A confirmed private-chat 403 blocks transport without withdrawing marketing consent. */
export async function blockDeliveryContact(
  tx: Transaction<DatabaseSchema>,
  botIdentity: string,
  telegramUserId: string,
  now: Date,
): Promise<void> {
  await contactLock(tx, botIdentity, telegramUserId);
  await updateMarketingAvailability(
    tx,
    botIdentity,
    telegramUserId,
    now,
    false,
  );
  await tx
    .updateTable("bot_contacts")
    .set({ contactability: "blocked", updated_at: now })
    .where("bot_identity", "=", botIdentity)
    .where("telegram_user_id", "=", telegramUserId)
    .execute();
}
