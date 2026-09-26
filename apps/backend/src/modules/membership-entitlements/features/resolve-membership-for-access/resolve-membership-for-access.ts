import {
  resolveAccessCapabilities,
  readAccessCapabilityFacts,
  projectAccessCapabilities,
} from "../resolve-access-capabilities/resolve-access-capabilities.js";
import type { AccountId } from "../../../accounts/index.js";
import type {
  MembershipAccessPrisma,
  MembershipEntitlementsPrismaClient,
} from "../../infrastructure/prisma.js";
import { setAccessSnapshotIsolation } from "../../infrastructure/access-isolation.js";
import type { MembershipAccessState } from "../../facets/membership-entitlements/membership-entitlements.interface.js";
import { guideCapability } from "@inside/access-capabilities";

export async function resolveMembershipForAccess(
  prisma: MembershipEntitlementsPrismaClient,
  accountId: AccountId,
  now: Date,
  guideIds?: readonly string[],
  materialId?: string,
): Promise<MembershipAccessState> {
  return prisma.$transaction(async (transaction) => {
    await setAccessSnapshotIsolation(transaction);
    return readMembershipForAccess(
      transaction,
      accountId,
      now,
      guideIds,
      materialId,
    );
  });
}

/**
 * Membership of the whole Account, read in the caller's transaction after it took
 * `lockAccountEntitlementChanges`. Every writer of the facts that open access takes that lock, so
 * the reads see one committed state without a snapshot of their own, and the caller needs no second
 * connection. The principal binding is written without it; it only tells an unknown state from a
 * required one, and neither opens access.
 */
export function resolveMembershipForAccessUnderEntitlementLock(
  transaction: MembershipAccessPrisma,
  accountId: AccountId,
  now: Date,
): Promise<MembershipAccessState> {
  return readMembershipForAccess(transaction, accountId, now);
}

async function readMembershipForAccess(
  prisma: MembershipAccessPrisma,
  accountId: AccountId,
  now: Date,
  guideIds?: readonly string[],
  materialId?: string,
): Promise<MembershipAccessState> {
  const result = await resolveAccessCapabilities(
    prisma,
    accountId,
    now,
    guideIds === undefined && materialId === undefined
      ? undefined
      : { guideIds: guideIds ?? [], materialId },
  );
  const relevant = result.capabilities.filter(
    ({ capability }) =>
      capability === "materials" ||
      (guideIds ?? []).some((id) => capability === guideCapability(id)),
  );
  if (relevant.length > 0)
    return {
      kind: "active",
      validUntil: relevant.some((value) => value.validUntil === null)
        ? null
        : (relevant
            .map((value) => value.validUntil)
            .sort()
            .at(-1) ?? null),
    };
  return result.membership;
}

export async function resolveMembershipForAccessMany(
  prisma: MembershipEntitlementsPrismaClient,
  accountId: AccountId,
  now: Date,
  resources: readonly {
    guideIds: readonly string[];
    materialId?: string | undefined;
  }[],
): Promise<readonly MembershipAccessState[]> {
  if (resources.length > 100) throw new Error("Membership batch exceeds bound");
  return prisma.$transaction(async (tx) => {
    await setAccessSnapshotIsolation(tx);
    const facts = await readAccessCapabilityFacts(tx, accountId, now);
    return resources.map((resource) => {
      const result = projectAccessCapabilities(facts, now, resource);
      const relevant = result.capabilities.filter(
        ({ capability }) =>
          capability === "materials" ||
          resource.guideIds.some((id) => capability === guideCapability(id)),
      );
      return relevant.length === 0
        ? result.membership
        : {
            kind: "active" as const,
            validUntil: relevant.some((value) => value.validUntil === null)
              ? null
              : (relevant
                  .map((value) => value.validUntil)
                  .sort()
                  .at(-1) ?? null),
          };
    });
  });
}
