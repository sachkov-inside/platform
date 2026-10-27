import type { Database } from "../../database/database.js";

export const CONTACT_MARKETING = Symbol("CONTACT_MARKETING");
/** Communications' `/stop` state of the bot's users; the application layer wires its owner read. */
export interface ContactMarketing {
  /** `false` after `/stop`; a user absent from the map has no communications record. */
  read(
    database: Database,
    botIdentity: string,
    telegramUserIds: readonly string[],
  ): Promise<ReadonlyMap<string, boolean>>;
}
