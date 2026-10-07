import {
  assembleMembershipEntitlements,
  type MembershipEntitlements,
} from "../../../src/modules/membership-entitlements/index.js";
import type { PlatformPrisma } from "../../../src/infrastructure/prisma/index.js";

export async function enrollLegacyCohortFixture(
  prisma: Pick<PlatformPrisma, "legacyClassification">,
  accountId: string,
): Promise<void> {
  await prisma.legacyClassification.createMany({
    data: {
      accountId,
      classification: "confirmed_legacy",
      sourceRef: "explicit-integration-cohort",
      reason: "Synthetic legacy cohort fixture",
      verifiedAt: new Date("2029-01-01T00:00:00Z"),
      revision: 1,
      bridgeEnabled: true,
      tributeStopped: false,
    },
    skipDuplicates: true,
  });
}

/** Existing evidence-v1 corpus describes members of the explicitly selected old cohort. */
export function assembleLegacyCohortFixture(
  dependencies: Parameters<typeof assembleMembershipEntitlements>[0],
): MembershipEntitlements {
  const membership = assembleMembershipEntitlements(dependencies);
  return {
    ...membership,
    async bindPrincipal(command, transaction) {
      // Inside the caller's transaction the fixture writes through it, as the binding does.
      await enrollLegacyCohortFixture(
        transaction !== undefined && writesClassification(transaction)
          ? transaction
          : dependencies.prisma,
        command.accountId,
      );
      return membership.bindPrincipal(command, transaction);
    },
    async acceptEvidence(command) {
      await enrollLegacyCohortFixture(dependencies.prisma, command.accountId);
      return membership.acceptEvidence(command);
    },
  };
}

/** A Prisma transaction client carries every delegate, beyond what its narrow type lists. */
function writesClassification(
  transaction: object,
): transaction is Pick<PlatformPrisma, "legacyClassification"> {
  return Reflect.get(transaction, "legacyClassification") !== undefined;
}
