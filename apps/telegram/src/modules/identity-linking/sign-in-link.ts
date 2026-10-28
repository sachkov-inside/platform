import { type Transaction } from "kysely";
import type { DatabaseSchema } from "../../database/database.js";

/** Reuses a reservation for the same Account even after expiry, as sign-in retries require. */
export async function reserveSignInLink(
  tx: Transaction<DatabaseSchema>,
  link: {
    requestRef: string;
    accountRef: string;
    tokenDigest: string;
    expiresAt: Date;
    botIdentity: string;
    telegramUserId: string;
    now: Date;
  },
): Promise<boolean> {
  const previous = await tx
    .selectFrom("link_transactions")
    .selectAll()
    .where("link_transaction_ref", "=", link.requestRef)
    .executeTakeFirst();
  if (previous) return previous.account_ref === link.accountRef;
  if (link.expiresAt <= link.now) return false;
  await tx
    .insertInto("link_transactions")
    .values({
      link_transaction_ref: link.requestRef,
      account_ref: link.accountRef,
      token_digest: link.tokenDigest,
      return_correlation: link.requestRef,
      expires_at: link.expiresAt,
      state: "received",
      bot_identity: link.botIdentity,
      candidate_telegram_user_id: link.telegramUserId,
      registered_at: link.now,
      received_at: link.now,
      confirmed_at: null,
    })
    .execute();
  return true;
}
