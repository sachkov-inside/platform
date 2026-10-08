import type { Database } from "../database/database.js";
import { botPlatformLinks } from "../modules/identity-linking/platform-links.js";
import type { GroupReportCandidate } from "../modules/community/group-members-report.js";

/** One consistent snapshot; old community bindings contribute IDs, never current Account links. */
export async function groupReportCandidates(
  database: Database,
  botIdentity: string,
): Promise<readonly GroupReportCandidate[]> {
  return database
    .transaction()
    .setIsolationLevel("repeatable read")
    .execute(async (transaction) => {
      const contacts = await transaction
        .selectFrom("bot_contacts")
        .select("telegram_user_id")
        .where("bot_identity", "=", botIdentity)
        .execute();
      const bindings = await transaction
        .selectFrom("community_bindings")
        .select("telegram_user_id")
        .where("bot_identity", "=", botIdentity)
        .where("telegram_user_id", "is not", null)
        .execute();
      const links = await botPlatformLinks(transaction, botIdentity);
      const candidates = new Map<string, GroupReportCandidate>();
      for (const row of [...contacts, ...bindings]) {
        if (row.telegram_user_id !== null)
          candidates.set(row.telegram_user_id, {
            telegramUserId: row.telegram_user_id,
            accountRef: null,
            identityRef: null,
          });
      }
      for (const link of links)
        candidates.set(link.telegramUserId, {
          telegramUserId: link.telegramUserId,
          accountRef: link.accountRef,
          identityRef: link.telegramIdentityRef,
        });
      return [...candidates.values()].sort((a, b) =>
        a.telegramUserId.localeCompare(b.telegramUserId),
      );
    });
}
