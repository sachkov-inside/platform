import { randomUUID } from "node:crypto";
import { productCapability } from "@inside/access-capabilities";
import { afterAll, beforeAll, expect, test } from "vitest";
import { assembleAccounts } from "../../src/modules/accounts/index.js";
import { BillingPricing } from "../../src/modules/billing/index.js";
import { CoverageCatalog } from "../../src/modules/materials/facets/coverage-catalog/coverage-catalog.js";
import { ProductDiscovery } from "../../src/modules/products/index.js";
import {
  createProductCommerceWorld,
  commerceValue as value,
} from "./setup/product-commerce.js";

const before = "10000000-0000-4000-8000-000000000000";
const productA = "20000000-0000-4000-8000-000000000000";
const unpublished = "25000000-0000-4000-8000-000000000000";
const archived = "27500000-0000-4000-8000-000000000000";
const productB = "30000000-0000-4000-8000-000000000000";
let world: Awaited<ReturnType<typeof createProductCommerceWorld>>;
let pricing: BillingPricing;

beforeAll(async () => {
  world = await createProductCommerceWorld();
  pricing = new BillingPricing({
    prisma: world.db.prisma,
    accounts: assembleAccounts({
      prisma: world.db.prisma,
      emailFingerprintKey: "pagination-test-fingerprint-key-000000000",
    }),
    contentCatalog: new CoverageCatalog(
      world.db.prisma,
      new ProductDiscovery(world.db.prisma),
    ),
    sale: { payments: true },
  });
  for (const productId of [productA, unpublished, archived, productB]) {
    await world.db.prisma.product.create({
      data: { id: productId, name: productId, slug: productId },
    });
    value(
      await pricing.manage(world.owner, {
        operation: "productPrices.save",
        operationId: randomUUID(),
        value: {
          productId,
          name: productId,
          priceKopecks: 200000,
          published: productId !== unpublished,
        },
      }),
    );
  }
  value(
    await pricing.manage(world.owner, {
      operation: "productPrices.archive",
      operationId: randomUUID(),
      expectedRevision: 1,
      id: archived,
    }),
  );
});
afterAll(async () => world.dispose());

test.each([
  ["before", before, [productA]],
  ["at", productA, []],
  ["after", unpublished, []],
] as const)(
  "Product-filtered offers retain their filter with a cursor %s the Product",
  async (_position, cursor, expected) => {
    const page = value(
      await pricing.offers({
        capability: productCapability(productA),
        cursor,
        limit: 1,
      }),
    );
    expect({
      ids: page.items.map((item) => item.offer.id),
      nextCursor: page.nextCursor,
    }).toEqual({
      ids: expected,
      nextCursor: null,
    });
  },
);

test("unfiltered public offers paginate only published non-archived Product prices", async () => {
  const first = value(await pricing.offers({ limit: 1 }));
  expect({
    ids: first.items.map((item) => item.offer.id),
    nextCursor: first.nextCursor,
  }).toEqual({
    ids: [productA],
    nextCursor: productA,
  });
  const second = value(
    await pricing.offers({ limit: 1, cursor: first.nextCursor }),
  );
  expect({
    ids: second.items.map((item) => item.offer.id),
    nextCursor: second.nextCursor,
  }).toEqual({
    ids: [productB],
    nextCursor: null,
  });
  const end = value(await pricing.offers({ limit: 1, cursor: productB }));
  expect(end).toEqual({ items: [], nextCursor: null });
  expect(value(await pricing.offers({ limit: 1, cursor: productA }))).toEqual(
    second,
  );
});
