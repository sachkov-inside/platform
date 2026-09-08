import type { PlatformPrisma } from "../infrastructure/prisma/index.js";

export async function enrollLegacyCohortFixture(
  prisma: Pick<PlatformPrisma, "legacyClassification">,
  accountId: string,
): Promise<void> {
  await prisma.legacyClassification.upsert({
    where: { accountId },
    create: {
      accountId,
      classification: "confirmed_legacy",
      sourceRef: "full-stack-synthetic-cohort",
      reason: "Development-only legacy fixture",
      verifiedAt: new Date(),
      revision: 1,
      bridgeEnabled: true,
      tributeStopped: false,
    },
    update: {},
  });
}
