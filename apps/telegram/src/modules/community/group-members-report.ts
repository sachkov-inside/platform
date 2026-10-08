import type { TelegramMembership } from "../membership-evidence/telegram-membership.js";
import {
  botHasMembershipPrerequisite,
  normalizeChatMember,
} from "../membership-evidence/membership-normalization.js";

export interface GroupReportCandidate {
  readonly telegramUserId: string;
  readonly accountRef: string | null;
  readonly identityRef: string | null;
}

export interface WithoutRightSnapshot {
  readonly checkedAt: string;
  readonly truncated: boolean;
  readonly identities: ReadonlyMap<string, string>;
}

type Category =
  "without_link" | "without_right" | "right_unknown" | "membership_unknown";

/** Read-only, bounded to known identities; absence from either source proves no positive right. */
export async function collectGroupMembersReport(input: {
  readonly candidates: readonly GroupReportCandidate[];
  readonly canonicalChatId: string;
  readonly telegram: TelegramMembership;
  readonly withoutRight: WithoutRightSnapshot;
}) {
  const startedAt = new Date().toISOString();
  const prerequisite = await input.telegram.getBotChatMember(
    input.canonicalChatId,
  );
  if (
    prerequisite.kind !== "observed" ||
    !botHasMembershipPrerequisite(prerequisite.value)
  ) {
    throw new Error("Group report requires an administrator bot");
  }
  const items: {
    telegramUserId: string;
    accountRef: string | null;
    category: Category;
  }[] = [];
  let notMembers = 0;
  for (const candidate of input.candidates) {
    const result = await input.telegram.getChatMember(
      input.canonicalChatId,
      candidate.telegramUserId,
    );
    const membership =
      result.kind === "observed"
        ? normalizeChatMember(result.value)
        : "unavailable";
    if (membership === "non_member") {
      notMembers += 1;
      continue;
    }
    const category: Category =
      membership === "unavailable"
        ? "membership_unknown"
        : candidate.accountRef === null
          ? "without_link"
          : candidate.identityRef !== null &&
              input.withoutRight.identities.get(candidate.identityRef) ===
                candidate.accountRef
            ? "without_right"
            : "right_unknown";
    items.push({
      telegramUserId: candidate.telegramUserId,
      accountRef: candidate.accountRef,
      category,
    });
  }
  return {
    startedAt,
    completedAt: new Date().toISOString(),
    coverage: "known_ids_only" as const,
    platformCheckedAt: input.withoutRight.checkedAt,
    platformTruncated: input.withoutRight.truncated,
    candidatesChecked: input.candidates.length,
    notMembers,
    items,
  };
}
