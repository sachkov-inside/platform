import type { z } from "zod";
import type { AccountRights } from "../../../account-rights/index.js";
import { accountId } from "../../../accounts/index.js";
import type { TelegramAccountLinks } from "../../../telegram-membership/index.js";
import { COMMUNICATIONS_VERSION } from "../../communications-contract.js";
import type { productAccessRequestSchema } from "../../communications-schema.generated.js";

/**
 * Which Telegram identities belong to an Account with active Product Access, so the bot keeps
 * marketing away from people who already have the course. An unlinked or ambiguous identity has
 * no Account and therefore no access.
 */
export async function readProductAccess(
  dependencies: {
    readonly links: Pick<TelegramAccountLinks, "findCurrentAccounts">;
    readonly rights: Pick<AccountRights, "resolveForAccessAccounts">;
  },
  request: z.infer<typeof productAccessRequestSchema>,
) {
  const current = await dependencies.links.findCurrentAccounts(
    request.telegramIdentityRefs,
  );
  if (!current.ok) return { status: "unavailable" } as const;
  const accountIds = [...new Set(current.accounts.values())];
  const resolve = dependencies.rights.resolveForAccessAccounts;
  if (resolve === undefined) return { status: "unavailable" } as const;
  // Without a Product filter the state covers every Product of the Account.
  const states = await resolve(accountIds.map((id) => accountId(id)));
  const withAccess: string[] = [];
  for (const identityRef of request.telegramIdentityRefs) {
    // The link read keys identities by their trimmed spelling.
    const account = current.accounts.get(identityRef.trim());
    if (account === undefined) continue;
    const state = states.get(account);
    if (
      state === undefined ||
      state.kind === "unavailable" ||
      state.kind === "stale"
    )
      return { status: "unavailable" } as const;
    if (state.kind === "active") withAccess.push(identityRef);
  }
  return {
    status: "ok",
    response: {
      contractVersion: COMMUNICATIONS_VERSION,
      requestId: request.requestId,
      withAccess,
    },
  } as const;
}
