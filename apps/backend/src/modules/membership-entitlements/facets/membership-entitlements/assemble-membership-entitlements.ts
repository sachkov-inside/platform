import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import type { ActivationBindings } from "../../domain/subscription-activation.js";
import type { MembershipEntitlementsPrismaClient } from "../../infrastructure/prisma.js";
import { acceptMembershipEvidence } from "../../features/accept-evidence/accept-evidence.js";
import { bindMembershipPrincipal } from "../../features/bind-principal/bind-membership-principal.js";
import { resolveMembershipForAccess, resolveMembershipForAccessMany, resolveMembershipUnderEntitlementLock } from "../../features/resolve-membership-for-access/resolve-membership-for-access.js";
import type {
  AcceptMembershipEvidenceCommand,
  MembershipAccessState,
  MembershipEntitlements,
  MembershipEvidenceAcceptance,
  MembershipPrincipalBinding,
} from "./membership-entitlements.interface.js";
import type { AccountId } from "../../../accounts/index.js";
import type { WorkshopEntitlements } from "../../../workshop/index.js";

export interface MembershipEntitlementsDependencies {
  readonly prisma: MembershipEntitlementsPrismaClient;
  readonly workshopEntitlements: Pick<
    WorkshopEntitlements,
    "applyAcceptedMembershipEvidence"
  >;
  readonly clock?: () => Date;
  readonly recipientLinks?: Pick<ActivationBindings, "readBinding">;
}

export function assembleMembershipEntitlements(
  dependencies: MembershipEntitlementsDependencies,
): MembershipEntitlements {
  const clock = dependencies.clock ?? (() => new Date());
  const membershipEntitlements: MembershipEntitlements = {
    async bindPrincipal(command): Promise<MembershipPrincipalBinding> {
      try {
        return await bindMembershipPrincipal(
          dependencies.prisma,
          command,
          clock(),
        );
      } catch (error) {
        return dependencyFailure({ module: "membership-entitlements", operation: "bindPrincipal" }, error, { ok: false, error: { code: "unavailable" } });
      }
    },
    resolveManyForAccess: (accountId, resources) => resolveMembershipForAccessMany(dependencies.prisma, accountId, clock(), resources),
    async resolveForAccess(
      accountId: AccountId,
      guideIds?: readonly string[],
      materialId?: string,
    ): Promise<MembershipAccessState> {
      try {
        return await resolveMembershipForAccess(
          dependencies.prisma,
          accountId,
          clock(),
          guideIds,
          materialId,
        );
      } catch (error) {
        return dependencyFailure({ module: "membership-entitlements", operation: "resolveForAccess" }, error, { kind: "unavailable" });
      }
    },
    async resolveForAccessUnderEntitlementLock(transaction, accountId): Promise<MembershipAccessState> {
      try {
        return await resolveMembershipUnderEntitlementLock(transaction, accountId, clock());
      } catch (error) {
        return dependencyFailure({ module: "membership-entitlements", operation: "resolveForAccessUnderEntitlementLock" }, error, { kind: "unavailable" });
      }
    },
    async acceptEvidence(
      command: AcceptMembershipEvidenceCommand,
    ): Promise<MembershipEvidenceAcceptance> {
      try {
        return await acceptMembershipEvidence(
          dependencies.prisma,
          dependencies.workshopEntitlements,
          command,
          clock(),
          dependencies.recipientLinks,
        );
      } catch (error) {
        return dependencyFailure({ module: "membership-entitlements", operation: "acceptEvidence" }, error, { ok: false, error: { code: "unavailable" } });
      }
    },
  };
  return Object.freeze(membershipEntitlements);
}
