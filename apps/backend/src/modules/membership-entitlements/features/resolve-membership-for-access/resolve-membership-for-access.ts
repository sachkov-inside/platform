import type { AccountId } from "../../../accounts/index.js";
import type { MembershipEntitlementsPrisma } from "../../infrastructure/prisma.js";
import type { MembershipAccessState } from "../../facets/membership-entitlements/membership-entitlements.interface.js";

export async function resolveMembershipForAccess(
  prisma: MembershipEntitlementsPrisma,
  accountId: AccountId,
  now: Date,
): Promise<MembershipAccessState> {
  const projection = await prisma.membershipProjection.findUnique({
    where: { accountId },
  });
  if (projection !== null) {
    if (projection.decision === "not_member") {
      return { kind: "expired" };
    }
    return now < projection.validUntil
      ? { kind: "active", validUntil: projection.validUntil.toISOString() }
      : { kind: "stale" };
  }

  const binding = await prisma.membershipBinding.findUnique({
    where: { accountId },
    select: { accountId: true },
  });
  if (binding !== null) {
    return { kind: "unavailable" };
  }

  const lastAcceptedWithoutEntitlement =
    await prisma.membershipEvidenceReceipt.findFirst({
      where: {
        accountId,
        outcome: "accepted_without_entitlement",
      },
      orderBy: [{ receivedAt: "desc" }, { deliveryId: "desc" }],
      select: { decision: true },
    });
  return lastAcceptedWithoutEntitlement?.decision === "unavailable" ||
    lastAcceptedWithoutEntitlement?.decision === "identity_conflict"
    ? { kind: "unavailable" }
    : { kind: "required" };
}
