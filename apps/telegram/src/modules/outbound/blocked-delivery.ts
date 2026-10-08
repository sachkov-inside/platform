import type { Transaction } from "kysely";
import type { DatabaseSchema } from "../../database/database.js";

export const BLOCKED_DELIVERY = Symbol("BLOCKED_DELIVERY");

/** Settles a held private-chat 403 together with its contact availability effect. */
export type BlockedDelivery = (
  tx: Transaction<DatabaseSchema>,
  botIdentity: string,
  telegramUserId: string,
  now: Date,
  settle: () => Promise<boolean>,
) => Promise<boolean>;
