import { resolveAccessCapabilities } from "../resolve-access-capabilities/resolve-access-capabilities.js";
import type { AccountId } from "../../../accounts/index.js";
import type { MembershipEntitlementsPrismaClient } from "../../infrastructure/prisma.js";
import { setAccessSnapshotIsolation } from "../../infrastructure/access-lock.js";
import type { MembershipAccessState } from "../../facets/membership-entitlements/membership-entitlements.interface.js";

export async function resolveMembershipForAccess(prisma: MembershipEntitlementsPrismaClient, accountId: AccountId, now: Date, guideIds: readonly string[] = []): Promise<MembershipAccessState> {
  return prisma.$transaction(async transaction => {
    await setAccessSnapshotIsolation(transaction);
    const result = await resolveAccessCapabilities(transaction, accountId, now);
    const relevant = result.capabilities.filter(({ capability }) => capability === "materials" || guideIds.some(id => capability === `guide:${id}`));
    if (relevant.length > 0) return { kind: "active", validUntil: relevant.some(value => value.validUntil === null)
      ? null : relevant.map(value => value.validUntil).sort().at(-1) ?? null };
    return result.membership;
  });
}
