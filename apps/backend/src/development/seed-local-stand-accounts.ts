import { CoverageCatalog } from "../modules/materials/facets/coverage-catalog/coverage-catalog.js";
import { ProductDiscovery } from "../modules/products/index.js";
import { randomUUID } from "node:crypto";
import type { PlatformPrisma } from "../infrastructure/prisma/index.js";
import { assembleAccessGrants } from "../modules/account-rights/index.js";
import {
  assembleAccounts,
  bootstrapOwnerAccount,
} from "../modules/accounts/index.js";

/** Development CLI fixture only. Existing Accounts, content and learning data are never reset. */
export async function seedLocalStandAccounts(
  prisma: PlatformPrisma,
  issuer: string,
  subjects: { owner: string; learner: string; learnerWithAccess: string },
  clock = () => new Date(),
) {
  if (new Set(Object.values(subjects)).size !== 3)
    throw new Error("Expected three distinct local stand identities");
  const owner = await bootstrapOwnerAccount(
    prisma,
    { issuer, subject: subjects.owner },
    "platform:admin",
  );
  async function learner(subject: string) {
    return (
      await prisma.account.upsert({
        where: {
          logtoIssuer_logtoSubject: {
            logtoIssuer: issuer,
            logtoSubject: subject,
          },
        },
        create: {
          id: randomUUID(),
          logtoIssuer: issuer,
          logtoSubject: subject,
        },
        update: {},
        select: { id: true },
      })
    ).id;
  }
  const plain = await learner(subjects.learner);
  const withAccess = await learner(subjects.learnerWithAccess);
  const accounts = assembleAccounts({
    prisma,
    emailFingerprintKey: "local-stand-fixture-does-not-establish-email",
  });
  const grants = assembleAccessGrants({
    prisma,
    accounts,
    clock,
    contentCatalog: new CoverageCatalog(prisma, new ProductDiscovery(prisma)),
  });
  const products = await prisma.product.findMany({
    select: { id: true },
    where: { archivedAt: null },
  });
  for (const target of [withAccess, owner.accountId])
    for (const product of products) {
      const result = await grants.issueProductAccess(
        { source: "manual", actorId: owner.accountId },
        {
          accountId: target,
          productId: product.id,
          sourceRef: `local-stand:${target}:${product.id}`,
          issuedAt: "2026-01-01T00:00:00.000Z",
          reason: "Development-only local stand Product access",
        },
      );
      if (!result.ok)
        throw new Error("Local stand Product access fixture failed");
    }
  return {
    owner: owner.accountId,
    learner: plain,
    learnerWithAccess: withAccess,
  };
}
