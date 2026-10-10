import type { Transaction } from "kysely";
import type { DatabaseSchema } from "../../database/database.js";
import type { VerifiedPrivateStart } from "../../shared/telegram-contact.js";

export const CONTACT_EFFECTS = Symbol("CONTACT_EFFECTS");
export interface ContactEffects {
  lock(
    tx: Transaction<DatabaseSchema>,
    bot: string,
    user: string,
  ): Promise<void>;
  availability(
    tx: Transaction<DatabaseSchema>,
    bot: string,
    user: string,
    now: Date,
    reachable: boolean,
  ): Promise<void>;
  ensure(
    tx: Transaction<DatabaseSchema>,
    bot: string,
    user: string,
  ): Promise<void>;
  reply(
    tx: Transaction<DatabaseSchema>,
    start: VerifiedPrivateStart,
    text: string,
  ): Promise<boolean>;
}
