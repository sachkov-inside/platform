import type { Accounts } from "../../../accounts/index.js";
import type { AccountId } from "../../../accounts/index.js";
import type { AccountPermissions } from "../../facets/content-access/content-access.dependencies.js";

export function assembleCurrentAccountPermissions(
  accounts: Pick<Accounts, "checkPermission" | "checkPermissionsMany">,
): AccountPermissions {
  return Object.freeze({
    async hasMaterialsManageMany(accountIds: readonly AccountId[]) {
      const decisions =
        accounts.checkPermissionsMany === undefined
          ? new Map(
              await Promise.all(
                accountIds.map(
                  async (id) =>
                    [
                      id,
                      await accounts.checkPermission({
                        accountId: id,
                        permission: "materials:manage",
                      }),
                    ] as const,
                ),
              ),
            )
          : await accounts.checkPermissionsMany({
              accountIds,
              permission: "materials:manage",
            });
      return new Map(
        accountIds.map((id) => {
          const result = decisions.get(id);
          return [
            id,
            result?.ok === true
              ? result.allowed
                ? ("granted" as const)
                : ("denied" as const)
              : ("unavailable" as const),
          ];
        }),
      );
    },
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
