import { blockBotContact } from "../bot-contacts/contact-access.js";
import type { Transaction } from "kysely";
import type { DatabaseSchema } from "../../database/database.js";
import { contactLock } from "./communication-state.js";
import { updateMarketingAvailability } from "./marketing-preferences.js";

/** A confirmed private-chat 403 blocks transport without withdrawing marketing consent. */
export async function blockDeliveryContact(
  tx: Transaction<DatabaseSchema>,
  botIdentity: string,
  telegramUserId: string,
  now: Date,
  startedAt: Date = now,
): Promise<void> {
  await contactLock(tx, botIdentity, telegramUserId);
  await blockBotContact(tx, botIdentity, telegramUserId, now, startedAt, () =>
    updateMarketingAvailability(tx, botIdentity, telegramUserId, now, false),
  );
}

/** Keeps contact-before-reply lock order and ignores an outcome whose lease was lost. */
export async function settleBlockedDelivery(
  tx: Transaction<DatabaseSchema>,
  botIdentity: string,
  telegramUserId: string,
  now: Date,
  settle: () => Promise<boolean>,
  startedAt: Date,
): Promise<boolean> {
  await contactLock(tx, botIdentity, telegramUserId);
  const held = await settle();
  if (held)
    await blockDeliveryContact(tx, botIdentity, telegramUserId, now, startedAt);
  return held;
}
