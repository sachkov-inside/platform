import { resolveAccessCapabilities, readAccessCapabilityFacts, projectAccessCapabilities } from "../resolve-access-capabilities/resolve-access-capabilities.js";
import type { AccountId } from "../../../accounts/index.js";
import type { MembershipEntitlementsPrismaClient } from "../../infrastructure/prisma.js";
import { setAccessSnapshotIsolation } from "../../infrastructure/access-isolation.js";
import type { MembershipAccessState } from "../../facets/membership-entitlements/membership-entitlements.interface.js";
import { guideCapability } from "@inside/access-capabilities";

export async function resolveMembershipForAccess(prisma: MembershipEntitlementsPrismaClient, accountId: AccountId, now: Date, guideIds?: readonly string[], materialId?: string): Promise<MembershipAccessState> {
  return prisma.$transaction(async transaction => {
    await setAccessSnapshotIsolation(transaction);
    const result = await resolveAccessCapabilities(transaction, accountId, now, guideIds === undefined && materialId === undefined ? undefined : { guideIds: guideIds ?? [], materialId });
    const relevant = result.capabilities.filter(({ capability }) => capability === "materials" || (guideIds ?? []).some(id => capability === guideCapability(id)));
    if (relevant.length > 0) return { kind: "active", validUntil: relevant.some(value => value.validUntil === null)
      ? null : relevant.map(value => value.validUntil).sort().at(-1) ?? null };
    return result.membership;
  });
}

export async function resolveMembershipForAccessMany(prisma: MembershipEntitlementsPrismaClient, accountId: AccountId, now: Date, resources: readonly { guideIds: readonly string[]; materialId?: string | undefined }[]): Promise<readonly MembershipAccessState[]> {
 if (resources.length > 100) throw new Error("Membership batch exceeds bound");
 return prisma.$transaction(async tx => { await setAccessSnapshotIsolation(tx); const facts = await readAccessCapabilityFacts(tx, accountId, now); return resources.map(resource => {
 const result = projectAccessCapabilities(facts, now, resource); const relevant = result.capabilities.filter(({ capability }) => capability === "materials" || resource.guideIds.some(id => capability === guideCapability(id)));
 return relevant.length === 0 ? result.membership : { kind: "active" as const, validUntil: relevant.some(value => value.validUntil === null) ? null : relevant.map(value => value.validUntil).sort().at(-1) ?? null };
 }); });
}
