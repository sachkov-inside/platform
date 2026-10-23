import { randomUUID } from "node:crypto";
import { assembleAccounts } from "../../../src/modules/accounts/index.js";
import { assembleAccessGrants } from "../../../src/modules/account-rights/index.js";
import { CoverageCatalog } from "../../../src/modules/materials/facets/coverage-catalog/coverage-catalog.js";
import { ProductDiscovery } from "../../../src/modules/products/index.js";
import type { PlatformPrisma } from "../../../src/infrastructure/prisma/index.js";

const owner = "a0090000-0000-4000-8000-000000000001";

async function fixtureGrants(prisma: PlatformPrisma) {
  for (const id of [owner])
    await prisma.account.upsert({
      where: { id },
      create: { id, logtoIssuer: "https://fixture.invalid", logtoSubject: id },
      update: {},
    });
  await prisma.accountPermission.upsert({
    where: {
      accountId_permission: { accountId: owner, permission: "platform:admin" },
    },
    create: { accountId: owner, permission: "platform:admin" },
    update: {},
  });
  return assembleAccessGrants({
    prisma,
    accounts: assembleAccounts({
      prisma,
      emailFingerprintKey: "product-access-fixture-fingerprint-key",
    }),
    contentCatalog: new CoverageCatalog(prisma, new ProductDiscovery(prisma)),
  });
}

/** Actual owner issuance through the public capability, with an Account/Product target for later withdrawal. */
export async function grantProductFixture(
  prisma: PlatformPrisma,
  accountId: string,
  productId: string,
): Promise<string> {
  await prisma.account.upsert({
    where: { id: accountId },
    create: {
      id: accountId,
      logtoIssuer: "https://fixture.invalid",
      logtoSubject: accountId,
    },
    update: {},
  });
  const grants = await fixtureGrants(prisma);
  const result = await grants.issueManualProductAccess(owner, {
    accountId,
    productId,
    sourceRef: randomUUID(),
    reason: "Synthetic Product holder",
  });
  if (!result.ok) throw new Error(result.error.code);
  return `${accountId}:${productId}`;
}

export async function revokeProductFixture(
  prisma: PlatformPrisma,
  target: string,
) {
  const [accountId, productId] = target.split(":");
  const grants = await fixtureGrants(prisma);
  const current = await grants.readProductAccess(owner, {
    accountId,
    productId,
  });
  if (!current.ok) throw new Error(current.error.code);
  const result = await grants.revokeProductAccess(owner, {
    accountId,
    productId,
    operationId: randomUUID(),
    expectedRevision: current.value.revision,
    reason: "Synthetic owner withdrawal",
  });
  if (!result.ok) throw new Error(result.error.code);
  return result;
}
