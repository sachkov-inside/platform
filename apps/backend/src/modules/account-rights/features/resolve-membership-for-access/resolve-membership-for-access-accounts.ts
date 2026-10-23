import { z } from "zod";
import type { AccountId } from "../../../accounts/index.js";
import type {
  AccountRightsPrismaClient,
  AccountRightsPrisma,
} from "../../infrastructure/prisma.js";
import { setAccessSnapshotIsolation } from "../../infrastructure/access-isolation.js";
import { resolveAccessCapabilitiesForAccounts } from "../resolve-access-capabilities/resolve-access-capabilities.js";
import type { MembershipAccessState } from "../../facets/account-rights/account-rights.interface.js";
export async function resolveMembershipForAccessAccounts(
  prisma: AccountRightsPrismaClient,
  accountIds: readonly AccountId[],
  now: Date,
  productIds?: readonly string[],
  materialId?: string,
  transaction?: AccountRightsPrisma,
): Promise<ReadonlyMap<string, MembershipAccessState>> {
  const ids = z.array(z.uuid()).parse(accountIds);
  if (ids.length === 0) return new Map();
  const read = async (tx: AccountRightsPrisma) => {
    const capabilities = await resolveAccessCapabilitiesForAccounts(
      tx,
      ids,
      now,
      productIds === undefined && materialId === undefined
        ? undefined
        : {
            productIds: productIds ?? [],
            ...(materialId === undefined ? {} : { materialId }),
          },
    );
    return new Map(
      ids.map((id) => [
        id,
        capabilities
          .get(id)
          ?.capabilities.some((row) => row.capability === "materials") === true
          ? { kind: "active" as const, validUntil: null }
          : { kind: "required" as const },
      ]),
    );
  };
  if (transaction !== undefined) return read(transaction);
  return prisma.$transaction(async (tx) => {
    await setAccessSnapshotIsolation(tx);
    return read(tx);
  });
}
