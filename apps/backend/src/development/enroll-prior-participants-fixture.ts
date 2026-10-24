import type { PlatformPrisma } from "../infrastructure/prisma/index.js";
import { assembleAccessGrants } from "../modules/account-rights/index.js";
import { assembleAccounts } from "../modules/accounts/index.js";
/** Synthetic Accounts receive only current concrete Products, never future platform-wide rights. */
export async function enrollPriorParticipantsFixture(
  prisma: PlatformPrisma,
  accountId: string,
): Promise<void> {
  const accounts = assembleAccounts({
    prisma,
    emailFingerprintKey: "synthetic-fullstack-product-fixture-key",
  });
  const grants = assembleAccessGrants({ prisma, accounts });
  const products = await prisma.product.findMany({
    where: { archivedAt: null },
    select: { id: true },
  });
  for (const product of products) {
    const result = await grants.issueProductAccess(
      { source: "course_activation" },
      {
        accountId,
        productId: product.id,
        sourceRef: `full-stack:${accountId}:${product.id}`,
        issuedAt: "2026-01-01T00:00:00.000Z",
        reason: "Synthetic full-stack Product fixture",
      },
    );
    if (!result.ok) throw new Error("Product fixture failed");
  }
}
