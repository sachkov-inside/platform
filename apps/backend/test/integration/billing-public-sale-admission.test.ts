import { productCapability } from "@inside/access-capabilities";
import { consentDocuments } from "@inside/legal";
import { afterAll, beforeAll, expect, test } from "vitest";
import {
  assembleAccounts,
  BillingContact,
} from "../../src/modules/accounts/index.js";
import { BillingPricing } from "../../src/modules/billing/index.js";
import { CoverageCatalog } from "../../src/modules/materials/index.js";
import { ProductDiscovery } from "../../src/modules/products/index.js";
import {
  createProductCommerceWorld,
  commerceValue as value,
} from "./setup/product-commerce.js";
let world: Awaited<ReturnType<typeof createProductCommerceWorld>>;
beforeAll(async () => {
  world = await createProductCommerceWorld();
});
afterAll(async () => world.dispose());

test("public offers respect the owning legal sale admission while owner prices remain readable", async () => {
  const s = await world.scenario();
  const contact = new BillingContact({
    prisma: world.db.prisma,
    emailFingerprintKey: "public-sale-admission-test-fingerprint-key",
    protection: undefined,
    sendCode: undefined,
    now: () => new Date("2030-01-31T10:00:00Z"),
    documents: consentDocuments("https://inside.example.test"),
  });
  expect(contact.hasApprovedProductTerms()).toBe(false);
  const dependencies = {
    prisma: world.db.prisma,
    accounts: assembleAccounts({
      prisma: world.db.prisma,
      emailFingerprintKey: "public-sale-admission-test-fingerprint-key",
    }),
    contentCatalog: new CoverageCatalog(
      world.db.prisma,
      new ProductDiscovery(world.db.prisma),
    ),
  };
  const unavailable = new BillingPricing({
    ...dependencies,
    sale: { payments: contact.hasApprovedProductTerms() },
  });
  const input = { capability: productCapability(s.productId) };
  expect(value(await unavailable.offers(input))).toEqual({
    items: [],
    nextCursor: null,
  });
  expect(
    value(await unavailable.saleAvailability({ productIds: [s.productId] }))
      .items,
  ).toEqual([{ productId: s.productId, sold: false }]);
  expect(value(await unavailable.ownerCatalog(input)).items).toHaveLength(1);
  // Only the owning process admission changes. Published price and Product facts are identical.
  const admitted = new BillingPricing({
    ...dependencies,
    sale: { payments: true },
  });
  expect(value(await admitted.offers(input)).items).toHaveLength(1);
  expect(
    value(await admitted.saleAvailability({ productIds: [s.productId] })).items,
  ).toEqual([{ productId: s.productId, sold: true }]);
  const unsupported = new BillingPricing({
    ...dependencies,
    sale: {
      payments: true,
      amountLimits: { minimumKopecks: 100, maximumKopecks: 100000 },
    },
  });
  expect(value(await unsupported.offers(input)).items).toEqual([]);
  expect(value(await unsupported.ownerCatalog(input)).items).toHaveLength(1);
});
