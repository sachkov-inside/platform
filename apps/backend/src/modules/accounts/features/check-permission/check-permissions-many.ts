import { z } from "zod";
import { setPermissionSnapshotIsolation } from "../../infrastructure/permission-snapshot.js";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import type { AccountsPrismaClient } from "../../../../infrastructure/prisma/index.js";
import type {
  PermissionDecision,
  PlatformPermission,
} from "../../facets/accounts/accounts.interface.js";
import { isPlatformPermission } from "../../domain/platform-permission.js";
import { internalFailure } from "../../shared/internal-failure.js";

/** Current existence and author permission for a bounded Account set, not an authorization cache. */
export async function checkPermissionsMany(
  prisma: AccountsPrismaClient,
  query: { accountIds: readonly string[]; permission: PlatformPermission },
): Promise<ReadonlyMap<string, PermissionDecision>> {
  const parsed = z.array(z.uuid()).safeParse(query.accountIds);
  if (!parsed.success || !isPlatformPermission(query.permission))
    return new Map(
      query.accountIds.map((id) => [
        id,
        { ok: false, error: { code: "invalid_input" } },
      ]),
    );
  const ids = [...new Set(parsed.data.map((id) => id.toLowerCase()))];
  if (ids.length === 0) return new Map();
  try {
    return await prisma.$transaction(async (tx) => {
      await setPermissionSnapshotIsolation(tx);
      const decisions = new Map<string, PermissionDecision>();
      for (let offset = 0; offset < ids.length; offset += 500) {
        const chunk = ids.slice(offset, offset + 500);
        const existing = await tx.account.findMany({
          where: { id: { in: chunk } },
          select: { id: true },
        });
        const grants =
          existing.length === 0
            ? []
            : await tx.accountPermission.findMany({
                where: {
                  accountId: { in: chunk },
                  permission: { in: [query.permission, "platform:admin"] },
                },
                select: { accountId: true },
              });
        const found = new Set(existing.map((row) => row.id));
        const allowed = new Set(grants.map((row) => row.accountId));
        for (const id of chunk)
          decisions.set(
            id,
            found.has(id)
              ? { ok: true, allowed: allowed.has(id) }
              : { ok: false, error: { code: "account_not_found" } },
          );
      }
      return new Map(
        parsed.data.map((id) => [
          id,
          decisions.get(id.toLowerCase()) ?? {
            ok: false as const,
            error: { code: "account_not_found" as const },
          },
        ]),
      );
    });
  } catch (error) {
    return dependencyFailure(
      { module: "accounts", operation: "checkPermissionsMany" },
      error,
      new Map(parsed.data.map((id) => [id, internalFailure()])),
    );
  }
}
