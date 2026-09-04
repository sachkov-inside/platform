import type { AccountId } from "../../../accounts/index.js";
import type { WorkshopEntitlementState } from "../../facets/workshop-entitlements/workshop-entitlements.interface.js";
import type { WorkshopEntitlementsPrisma } from "../../infrastructure/prisma.js";

export async function resolveWorkshopEntitlement(
  prisma: WorkshopEntitlementsPrisma,
  accountId: AccountId,
  now: Date,
): Promise<WorkshopEntitlementState> {
  const projection = await prisma.workshopMembershipEntitlementProjection.findUnique({
    where: { accountId },
  });
  if (projection === null) return { kind: "required" };
  if (projection.decision === "not_member") return { kind: "expired" };
  return now < projection.validUntil
    ? { kind: "active", validUntil: projection.validUntil.toISOString() }
    : { kind: "stale" };
}
