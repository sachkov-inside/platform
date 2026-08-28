import type { Accounts } from "../../../accounts/index.js";
import type { AccountId } from "../../../accounts/index.js";
import type { AccountPermissions } from "../../facets/content-access/content-access.dependencies.js";

export function assembleCurrentAccountPermissions(
  accounts: Pick<Accounts, "checkPermission">,
): AccountPermissions {
  return Object.freeze({
    async hasMaterialsManage(accountId: AccountId) {
      const result = await accounts.checkPermission({
        accountId,
        permission: "materials:manage",
      });
      if (!result.ok) {
        throw new Error(`Account permission read failed: ${result.error.code}`);
      }
      return result.allowed;
    },
  });
}
