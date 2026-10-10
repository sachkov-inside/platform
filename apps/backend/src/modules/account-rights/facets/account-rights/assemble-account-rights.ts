import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import type { ActivationBindings } from "../../domain/subscription-activation.js";
import type { AccountRightsPrismaClient } from "../../infrastructure/prisma.js";
import { acceptMembershipEvidence } from "../../features/accept-evidence/accept-evidence.js";
import { bindMembershipPrincipal } from "../../features/bind-principal/bind-membership-principal.js";
import {
  resolveMembershipForAccess,
  resolveMembershipForAccessMany,
  resolveMembershipForAccessUnderEntitlementLock,
} from "../../features/resolve-membership-for-access/resolve-membership-for-access.js";
import type {
  AcceptMembershipEvidenceCommand,
  MembershipAccessState,
  AccountRights,
  MembershipEvidenceAcceptance,
  MembershipPrincipalBinding,
} from "./account-rights.interface.js";
import type { AccountId } from "../../../accounts/index.js";

export interface AccountRightsDependencies {
  readonly prisma: AccountRightsPrismaClient;
  readonly clock?: () => Date;
  readonly recipientLinks?: Pick<ActivationBindings, "readBinding">;
}

export function assembleAccountRights(
  dependencies: AccountRightsDependencies,
): AccountRights {
  const clock = dependencies.clock ?? (() => new Date());
  const accountRights: AccountRights = {
    async bindPrincipal(
      command,
      transaction,
    ): Promise<MembershipPrincipalBinding> {
      try {
        return await bindMembershipPrincipal(
          dependencies.prisma,
          command,
          clock(),
          transaction,
        );
      } catch (error) {
        return dependencyFailure(
          { module: "account-rights", operation: "bindPrincipal" },
          error,
          { ok: false, error: { code: "unavailable" } },
        );
      }
    },
    resolveManyForAccess: (accountId, resources) =>
      resolveMembershipForAccessMany(
        dependencies.prisma,
        accountId,
        clock(),
        resources,
      ),
    async resolveForAccess(
      accountId: AccountId,
      productIds?: readonly string[],
      materialId?: string,
    ): Promise<MembershipAccessState> {
      try {
        return await resolveMembershipForAccess(
          dependencies.prisma,
          accountId,
          clock(),
          productIds,
          materialId,
        );
      } catch (error) {
        return dependencyFailure(
          { module: "account-rights", operation: "resolveForAccess" },
          error,
          { kind: "unavailable" },
        );
      }
    },
    async resolveForAccessUnderEntitlementLock(
      transaction,
      accountId,
    ): Promise<MembershipAccessState> {
      try {
        return await resolveMembershipForAccessUnderEntitlementLock(
          transaction,
          accountId,
          clock(),
        );
      } catch (error) {
        return dependencyFailure(
          {
            module: "account-rights",
            operation: "resolveForAccessUnderEntitlementLock",
          },
          error,
          { kind: "unavailable" },
        );
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
          dependencies.recipientLinks,
        );
      } catch (error) {
        return dependencyFailure(
          { module: "account-rights", operation: "acceptEvidence" },
          error,
          { ok: false, error: { code: "unavailable" } },
        );
      }
    },
  };
  return Object.freeze(accountRights);
}
