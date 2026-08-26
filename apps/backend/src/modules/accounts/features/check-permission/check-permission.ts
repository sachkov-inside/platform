import type { AccountsPrismaClient } from "../../../../infrastructure/prisma/index.js";
import { parseAccountId } from "../../domain/account-identifiers.js";
import type {
  PermissionDecision,
  PlatformPermission,
} from "../../facets/accounts/accounts.interface.js";
import { internalFailure } from "../../shared/internal-failure.js";

export async function checkPermission(
  prisma: AccountsPrismaClient,
  query: {
    readonly accountId: string;
    readonly permission: PlatformPermission;
  },
): Promise<PermissionDecision> {
  const accountId = parseAccountId(query.accountId);
  if (accountId === undefined || query.permission !== "materials:manage") {
    return { ok: false, error: { code: "invalid_input" } };
  }
  try {
    const account = await prisma.account.findUnique({
      where: { id: accountId },
      select: { id: true },
    });
    if (account === null) {
      return { ok: false, error: { code: "account_not_found" } };
    }
    const grant = await prisma.accountPermission.findUnique({
      where: {
        accountId_permission: { accountId, permission: query.permission },
      },
      select: { accountId: true },
    });
    return { ok: true, allowed: grant !== null };
  } catch {
    return internalFailure();
  }
}
