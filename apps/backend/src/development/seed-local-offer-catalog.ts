import { assembleAccounts } from "../modules/accounts/index.js";
import { CoverageCatalog } from "../modules/materials/facets/coverage-catalog/coverage-catalog.js";
import { ProductDiscovery } from "../modules/products/index.js";
import { randomUUID } from "node:crypto";
import type { PlatformPrisma } from "../infrastructure/prisma/index.js";
import { BillingPricing } from "../modules/billing/index.js";
/** Development-only Product price. Existing sales closure stays under its owner's control. */
export async function seedLocalOfferCatalog(
  prisma: PlatformPrisma,
  target: {
    readonly actor: string;
    readonly productId: string;
    readonly onSale?: boolean;
  },
): Promise<void> {
  await prisma.account.upsert({
    where: { id: target.actor },
    create: {
      id: target.actor,
      logtoIssuer: "https://local-seed.fixture.invalid",
      logtoSubject: target.actor,
    },
    update: {},
  });
  await prisma.accountPermission.upsert({
    where: {
      accountId_permission: {
        accountId: target.actor,
        permission: "billing:manage",
      },
    },
    create: { accountId: target.actor, permission: "billing:manage" },
    update: {},
  });
  const pricing = new BillingPricing({
    contentCatalog: new CoverageCatalog(prisma, new ProductDiscovery(prisma)),
    prisma,
    sale: { payments: true },
    accounts: assembleAccounts({
      prisma,
      emailFingerprintKey: "local-seed-development-fingerprint-key-00000",
    }),
  });
  const current = await prisma.billingProductPrice.findUnique({
    where: { productId: target.productId },
  });
  const name = "Руководство «Создание Platform Inside»",
    priceKopecks = 3000;
  if (current?.archived) return;
  const published =
    target.onSale === false ? false : (current?.published ?? true);
  if (
    current?.name === name &&
    Number(current.priceKopecks) === priceKopecks &&
    current.published === published
  )
    return;
  const result = await pricing.manage(target.actor, {
    operation: "productPrices.save",
    operationId: randomUUID(),
    ...(current === null ? {} : { expectedRevision: current.revision }),
    value: { productId: target.productId, name, priceKopecks, published },
  });
  if (!result.ok)
    throw new Error(`Local Product price fixture failed: ${result.error.code}`);
}
