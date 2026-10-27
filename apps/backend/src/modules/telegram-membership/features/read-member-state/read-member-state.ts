import { z } from "zod";

import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import type { TelegramMembershipPrismaClient } from "../../../../infrastructure/prisma/index.js";
import {
  communityResultSchema,
  type ObservedMembership,
} from "../../domain/community-entitlement.js";
import type { TelegramAccountLinks } from "../../facets/telegram-account-links/telegram-account-links.js";

/**
 * What Platform knows about one Account in the community. Every field is a recorded fact of the
 * current Telegram link; a missing or unanswered provider observation stays `unknown`, never
 * "not a member" or "not restricted".
 */
export interface CommunityMemberState {
  readonly link:
    | { readonly state: "linked"; readonly telegramIdentityRef: string }
    | { readonly state: "not_linked" };
  /** The provider's last observation of the linked identity in the group. */
  readonly membership: ObservedMembership;
  /** Admission restriction from that observation; `unknown` when it was not reported. */
  readonly restriction: "none" | "moderation" | "external_unknown" | "unknown";
  /** When the provider made that observation; `null` when there is none. */
  readonly observedAt: string | null;
}

export type ReadMemberStateResult =
  | { readonly ok: true; readonly value: CommunityMemberState }
  | {
      readonly ok: false;
      readonly error: { readonly code: "invalid_input" | "unavailable" };
    };

const unobserved = {
  membership: "unknown",
  restriction: "unknown",
  observedAt: null,
} as const;

/**
 * The link and the last community observation of one Account, read without an actor: the
 * composing read checks its own right first. An observation counts only when it was made for the
 * current link (identity, link and its revision).
 */
export async function readMemberState(
  dependencies: {
    readonly prisma: TelegramMembershipPrismaClient;
    readonly links: Pick<TelegramAccountLinks, "readBinding">;
  },
  accountId: string,
): Promise<ReadMemberStateResult> {
  if (!z.uuid().safeParse(accountId).success)
    return { ok: false, error: { code: "invalid_input" } };
  try {
    const current = await dependencies.links.readBinding({ accountId });
    if (!current.ok) return { ok: false, error: { code: "unavailable" } };
    const binding = current.binding;
    if (binding?.accountRef == null || binding.telegramIdentityRef === null)
      return {
        ok: true,
        value: { link: { state: "not_linked" }, ...unobserved },
      };
    const link = {
      state: "linked",
      telegramIdentityRef: binding.telegramIdentityRef,
    } as const;
    // A newer operation without an answer has not observed anything yet.
    const observation =
      await dependencies.prisma.telegramCommunityOperation.findFirst({
        where: { accountId, observedMembership: { not: null } },
        orderBy: { entitlementRevision: "desc" },
        select: { result: true },
      });
    const result = communityResultSchema.safeParse(observation?.result);
    if (
      !result.success ||
      result.data.binding.telegramIdentityRef !== binding.telegramIdentityRef ||
      result.data.binding.linkRef !== binding.linkRef ||
      result.data.binding.linkRevision !== binding.linkRevision
    )
      return { ok: true, value: { link, ...unobserved } };
    return {
      ok: true,
      value: {
        link,
        membership: result.data.observedMembership,
        restriction: result.data.admissionRestriction ?? "unknown",
        observedAt: new Date(result.data.updatedAt).toISOString(),
      },
    };
  } catch (error) {
    return dependencyFailure(
      { module: "telegram-membership", operation: "readMemberState" },
      error,
      { ok: false, error: { code: "unavailable" } },
    );
  }
}
