import type { PlatformPrisma } from "../infrastructure/prisma/index.js";

export async function enrollLegacyCohortFixture(
  prisma: Pick<PlatformPrisma, "legacyClassification" | "material">,
  accountId: string,
): Promise<void> {
  // Freeze the seeded local corpus; the production bridge never means all future products.
  const materialIds = (await prisma.material.findMany({ select: { id: true } })).map(row => row.id);
  const bridgeContentScope = { guideIds: [], materialIds };
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
