import type { MembershipEntitlementsPrismaClient } from "../../infrastructure/prisma.js";
import { acceptMembershipEvidence } from "../../features/accept-evidence/accept-evidence.js";
import { bindMembershipPrincipal } from "../../features/bind-principal/bind-membership-principal.js";
import { resolveMembershipForAccess } from "../../features/resolve-membership-for-access/resolve-membership-for-access.js";
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
      } catch {
        return { ok: false, error: { code: "unavailable" } };
      }
    },
    async resolveForAccess(
      accountId: AccountId,
    ): Promise<MembershipAccessState> {
      try {
        return await resolveMembershipForAccess(
          dependencies.prisma,
          accountId,
          clock(),
        );
      } catch {
        return { kind: "unavailable" };
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
        );
      } catch {
        return { ok: false, error: { code: "unavailable" } };
      }
    },
  };
  return Object.freeze(membershipEntitlements);
}
