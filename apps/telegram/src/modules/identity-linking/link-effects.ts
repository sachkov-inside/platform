import type { Transaction } from "kysely";
import type { DatabaseSchema } from "../../database/database.js";
import type { PlatformLink } from "./platform-links.js";

export const LINK_EFFECTS = Symbol("LINK_EFFECTS");
export interface LinkEffects {
  initialCheck(
    tx: Transaction<DatabaseSchema>,
    source: string,
    identity: string,
    now: Date,
  ): Promise<void>;
  accountLinked(
    tx: Transaction<DatabaseSchema>,
    link: Pick<
      PlatformLink,
      | "botIdentity"
      | "telegramUserId"
      | "telegramIdentityRef"
      | "linkedAt"
      | "linkTransactionRef"
    >,
  ): Promise<void>;
  signInAllowsLink(
    tx: Transaction<DatabaseSchema>,
    bot: string,
    user: string,
    request: string,
  ): Promise<boolean>;
}
