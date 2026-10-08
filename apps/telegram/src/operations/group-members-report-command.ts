import type { Database } from "../database/database.js";
import type { TelegramMembership } from "../modules/membership-evidence/telegram-membership.js";
import { readGroupReportRights } from "../adapters/platform/http-group-report.adapter.js";
import { collectGroupMembersReport } from "../modules/community/group-members-report.js";
import { groupReportCandidates } from "./group-report-candidates.js";
import { saveGroupMembersReport } from "./group-report-file.js";

/** The runtime command's complete read-and-save operation; only external boundaries are supplied. */
export async function runGroupMembersReport(input: {
  readonly database: Database;
  readonly botIdentity: string;
  readonly canonicalChatId: string;
  readonly telegram: TelegramMembership;
  readonly platformEndpoint: string;
  readonly operatorToken: string;
  readonly output: string;
  readonly fetcher?: typeof fetch;
}): Promise<void> {
  const withoutRight = await readGroupReportRights(
    input.platformEndpoint,
    input.operatorToken,
    input.fetcher,
  );
  const candidates = await groupReportCandidates(
    input.database,
    input.botIdentity,
  );
  const report = await collectGroupMembersReport({
    candidates,
    canonicalChatId: input.canonicalChatId,
    telegram: input.telegram,
    withoutRight,
  });
  await saveGroupMembersReport(input.output, report);
}
