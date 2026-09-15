import type { PlatformPrisma } from "../infrastructure/prisma/index.js";

export async function enrollLegacyCohortFixture(
  prisma: Pick<PlatformPrisma, "legacyClassification">,
  accountId: string,
): Promise<void> {
  // The bridge opens what the starter tier opens: every product of the platform, including new ones.
  const bridgeContentScope = { guideIds: [], materialIds: [], allGuides: true };
  await prisma.legacyClassification.createMany({
    data: {
      accountId,
      classification: "confirmed_legacy",
      sourceRef: "full-stack-synthetic-cohort",
      reason: "Development-only legacy fixture",
      verifiedAt: new Date(),
      revision: 1,
      bridgeEnabled: true,
      bridgeContentScope,
      tributeStopped: false,
    },
    skipDuplicates: true,
  });
  await prisma.legacyClassification.updateMany({ where: { accountId, sourceRef: "full-stack-synthetic-cohort" },
    data: { bridgeContentScope } });
}
