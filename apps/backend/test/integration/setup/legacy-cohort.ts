import {
  assembleMembershipEntitlements,
  type MembershipEntitlements,
} from "../../../src/modules/membership-entitlements/index.js";
import type { PlatformPrisma } from "../../../src/infrastructure/prisma/index.js";

export async function enrollLegacyCohortFixture(
  prisma: Pick<PlatformPrisma, "legacyClassification">,
  accountId: string,
): Promise<void> {
  await prisma.legacyClassification.upsert({
    where: { accountId },
    create: {
      accountId,
      classification: "confirmed_legacy",
      sourceRef: "explicit-integration-cohort",
      reason: "Synthetic legacy cohort fixture",
      verifiedAt: new Date("2029-01-01T00:00:00Z"),
      revision: 1,
      bridgeEnabled: true,
      tributeStopped: false,
    },
    update: {},
  });
}

/** Existing evidence-v1 corpus describes members of the explicitly selected old cohort. */
export function assembleLegacyCohortFixture(
  dependencies: Parameters<typeof assembleMembershipEntitlements>[0],
): MembershipEntitlements {
  const membership = assembleMembershipEntitlements(dependencies);
  return {
    ...membership,
    async bindPrincipal(command) {
      await enrollLegacyCohortFixture(dependencies.prisma, command.accountId);
      return membership.bindPrincipal(command);
    },
    async acceptEvidence(command) {
      await enrollLegacyCohortFixture(dependencies.prisma, command.accountId);
      return membership.acceptEvidence(command);
    },
  };
}
