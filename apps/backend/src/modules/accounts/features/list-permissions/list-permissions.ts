import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import type { AccountsPrisma } from "../../../../infrastructure/prisma/index.js";
import { parseAccountId } from "../../domain/account-identifiers.js";
import {
  isPlatformPermission,
  platformPermissions,
} from "../../domain/platform-permission.js";
import type { PermissionList } from "../../facets/accounts/accounts.interface.js";
import { internalFailure } from "../../shared/internal-failure.js";

/**
 * Effective permissions of one Account in `platformPermissions` order. `platform:admin` covers
 * every permission, as `checkPermission` decides; an unknown stored value grants nothing.
 */
export async function listPermissions(
  prisma: AccountsPrisma,
  query: { readonly accountId: string },
): Promise<PermissionList> {
  const accountId = parseAccountId(query.accountId);
  if (accountId === undefined) {
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
    const grants = await prisma.accountPermission.findMany({
      where: { accountId },
      select: { permission: true },
    });
    const granted = new Set(
      grants.map(({ permission }) => permission).filter(isPlatformPermission),
    );
    return {
      ok: true,
      permissions: granted.has("platform:admin")
        ? [...platformPermissions]
        : platformPermissions.filter((permission) => granted.has(permission)),
    };
  } catch (error) {
    return dependencyFailure(
      { module: "accounts", operation: "listPermissions" },
      error,
      internalFailure(),
    );
  }
}
