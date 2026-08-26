import type { AccountsPrismaClient } from "../../../../infrastructure/prisma/index.js";
import { parseAccountId } from "../../domain/account-identifiers.js";
import type {
  ResolveAccountResult,
  VerifiedAccountIdentity,
} from "../../facets/accounts/accounts.interface.js";
import { validLogtoIdentity } from "../../shared/account-input.js";
import { internalFailure } from "../../shared/internal-failure.js";

export async function resolveAccount(
  prisma: AccountsPrismaClient,
  query: { readonly identity: VerifiedAccountIdentity },
): Promise<ResolveAccountResult> {
  if (!validLogtoIdentity(query.identity)) {
    return { ok: false, error: { code: "invalid_input" } };
  }
  try {
    const account = await prisma.account.findUnique({
      where: {
        logtoIssuer_logtoSubject: {
          logtoIssuer: query.identity.issuer,
          logtoSubject: query.identity.subject,
        },
      },
      select: { id: true },
    });
    if (account === null) {
      return { ok: false, error: { code: "account_not_found" } };
    }
    const accountId = parseAccountId(account.id);
    return accountId === undefined
      ? internalFailure()
      : { ok: true, account: { accountId } };
  } catch {
    return internalFailure();
  }
}
