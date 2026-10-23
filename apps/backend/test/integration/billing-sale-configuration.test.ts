import { afterAll, beforeAll, expect, test } from "vitest";
import { BillingPricing } from "../../src/modules/billing/index.js";
import { assembleAccounts } from "../../src/modules/accounts/index.js";
import { CoverageCatalog } from "../../src/modules/materials/facets/coverage-catalog/coverage-catalog.js";
import { ProductDiscovery } from "../../src/modules/products/index.js";
import { createProductCommerceWorld } from "./setup/product-commerce.js";
let world: Awaited<ReturnType<typeof createProductCommerceWorld>>;
beforeAll(async () => {
  world = await createProductCommerceWorld();
});
afterAll(async () => world.dispose());
test("empty catalogue starts without a bank; current published Product requires terminal and receipt transport", async () => {
  const pricing = new BillingPricing({
    prisma: world.db.prisma,
    accounts: assembleAccounts({
      prisma: world.db.prisma,
      emailFingerprintKey: "sale-config-fingerprint-key-00000000",
    }),
    contentCatalog: new CoverageCatalog(
      world.db.prisma,
      new ProductDiscovery(world.db.prisma),
    ),
    sale: { payments: true },
  });
  await expect(
    pricing.assertSaleConfigured({
      tbank: undefined,
      billingContact: undefined,
    }),
  ).resolves.toBeUndefined();
  await world.scenario();
  await expect(
    pricing.assertSaleConfigured({
      tbank: undefined,
      billingContact: undefined,
    }),
  ).rejects.toThrow();
});
