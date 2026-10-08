import {
  assembleAccountRights,
  type AccountRights,
} from "../../../src/modules/account-rights/index.js";
import type { PlatformPrisma } from "../../../src/infrastructure/prisma/index.js";

export async function enrollPriorParticipantsFixture(
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
export function assemblePriorParticipantsFixture(
  dependencies: Parameters<typeof assembleAccountRights>[0],
): AccountRights {
  const membership = assembleAccountRights(dependencies);
  return {
    ...membership,
    async bindPrincipal(command, transaction) {
      // Inside the caller's transaction the fixture writes through it, as the binding does.
      await enrollPriorParticipantsFixture(
        transaction !== undefined && hasLegacyClassification(transaction)
          ? transaction
          : dependencies.prisma,
        command.accountId,
      );
      return membership.bindPrincipal(command, transaction);
    },
    async acceptEvidence(command) {
      await enrollPriorParticipantsFixture(
        dependencies.prisma,
        command.accountId,
      );
      return membership.acceptEvidence(command);
    },
  };
}

/** A Prisma transaction client carries every delegate, beyond what its narrow type lists. */
function hasLegacyClassification(
  transaction: object,
): transaction is Pick<PlatformPrisma, "legacyClassification"> {
  return Reflect.get(transaction, "legacyClassification") !== undefined;
}
