import type { MembershipEntitlementsPrismaClient } from "../../infrastructure/prisma.js";
import { acceptMembershipEvidence } from "../../features/accept-evidence/accept-evidence.js";
import { resolveMembershipForAccess } from "../../features/resolve-for-access/resolve-for-access.js";
import type {
  AcceptMembershipEvidenceCommand,
  MembershipAccessState,
  MembershipEntitlements,
  MembershipEvidenceAcceptance,
} from "./membership-entitlements.interface.js";
import type { AccountId } from "../../../accounts/index.js";

export interface MembershipEntitlementsDependencies {
  readonly prisma: MembershipEntitlementsPrismaClient;
  readonly clock?: () => Date;
}

export function assembleMembershipEntitlements(
  dependencies: MembershipEntitlementsDependencies,
): MembershipEntitlements {
  const clock = dependencies.clock ?? (() => new Date());
  const membershipEntitlements: MembershipEntitlements = {
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
