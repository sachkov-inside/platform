import type { Accounts } from "../../../accounts/index.js";
import type { TelegramAccountLinks } from "../../../telegram-membership/index.js";
import { COMMUNICATIONS_VERSION, type AuthorAuthorizationRequest } from "../../communications-contract.js";

export async function authorizeAuthor(
  dependencies: { readonly accounts: Accounts; readonly links: TelegramAccountLinks; readonly botIdentity: string },
  request: AuthorAuthorizationRequest,
) {
  const denied = { contractVersion: COMMUNICATIONS_VERSION, requestId: request.requestId, status: "denied" } as const;
  const subject = request.subject;
  if (subject.kind === "telegram" && subject.botIdentity !== dependencies.botIdentity) return denied;
  const result = await dependencies.links.find({ accountRef: subject.accountRef });
  if (!result.ok) return { status: "unavailable" } as const;
  const link = result.link;
  if (link === null || (subject.kind === "telegram" && link.telegramIdentityRef !== subject.telegramIdentityRef)) return denied;
  const permission = await dependencies.accounts.checkPermission({ accountId: link.accountId, permission: "communications:manage" });
  if (!permission.ok && permission.error.code === "internal_error") return { status: "unavailable" } as const;
  if (!permission.ok || !permission.allowed) return denied;
  return { contractVersion: COMMUNICATIONS_VERSION, requestId: request.requestId, status: "allowed", accountRef: link.accountRef } as const;
}
