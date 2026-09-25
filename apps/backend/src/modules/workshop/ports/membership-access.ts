import type { AccountId } from "../../accounts/index.js";
import type { WorkshopPrismaTransaction } from "../infrastructure/prisma.js";

/**
 * The Membership decision a Workshop grant needs, taken inside the grant's own transaction under
 * the entitlement lock. Membership Entitlements implements this port.
 */
export interface WorkshopMembershipAccess {
  resolveForAccessUnderEntitlementLock(
    transaction: WorkshopPrismaTransaction,
    accountId: AccountId,
  ): Promise<Readonly<{ kind: "active" | "required" | "expired" | "stale" | "unavailable" }>>;
}
