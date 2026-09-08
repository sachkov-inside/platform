import { resolveAccessCapabilities } from "../resolve-access-capabilities/resolve-access-capabilities.js";
import type { AccountId } from "../../../accounts/index.js";
import type { MembershipEntitlementsPrismaClient } from "../../infrastructure/prisma.js";
import { setAccessSnapshotIsolation } from "../../infrastructure/access-lock.js";
import type { MembershipAccessState } from "../../facets/membership-entitlements/membership-entitlements.interface.js";

export async function resolveMembershipForAccess(prisma: MembershipEntitlementsPrismaClient, accountId: AccountId, now: Date): Promise<MembershipAccessState> {
  return prisma.$transaction(async transaction => {
    await setAccessSnapshotIsolation(transaction);
    return (await resolveAccessCapabilities(transaction, accountId, now)).membership;
  });
}
