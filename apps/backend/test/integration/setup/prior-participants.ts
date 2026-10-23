import { assembleAccountRights } from "../../../src/modules/account-rights/index.js";
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

/** Rights reader only. Legacy evidence does not issue Product Access. */
export const assemblePriorParticipantsFixture = assembleAccountRights;
