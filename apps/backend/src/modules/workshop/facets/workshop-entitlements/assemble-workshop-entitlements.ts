import type { AccountId } from "../../../accounts/index.js";
import { applyAcceptedMembershipEvidence } from "../../features/apply-membership-entitlement/apply-membership-entitlement.js";
import { resolveWorkshopEntitlement } from "../../features/resolve-workshop-entitlement/resolve-workshop-entitlement.js";
import type { WorkshopEntitlementsPrisma } from "../../infrastructure/prisma.js";
import type {
  AcceptedMembershipEvidence,
  WorkshopEntitlements,
  WorkshopEntitlementState,
  WorkshopEntitlementTransaction,
} from "./workshop-entitlements.interface.js";

export interface WorkshopEntitlementsDependencies {
  readonly prisma: WorkshopEntitlementsPrisma;
  readonly clock?: () => Date;
}

export function assembleWorkshopEntitlements(
  dependencies: WorkshopEntitlementsDependencies,
): WorkshopEntitlements {
  const clock = dependencies.clock ?? (() => new Date());

  return Object.freeze({
    applyAcceptedMembershipEvidence(
      transaction: WorkshopEntitlementTransaction,
      evidence: AcceptedMembershipEvidence,
    ): Promise<void> {
      return applyAcceptedMembershipEvidence(transaction, evidence);
    },
    async resolveForAccess(
      accountId: AccountId,
    ): Promise<WorkshopEntitlementState> {
      try {
        return await resolveWorkshopEntitlement(
          dependencies.prisma,
          accountId,
          clock(),
        );
      } catch {
        return { kind: "unavailable" };
      }
    },
  });
}
