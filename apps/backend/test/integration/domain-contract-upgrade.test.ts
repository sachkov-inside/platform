import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { Prisma } from "../../src/infrastructure/prisma/index.js";
import { ProductDiscovery } from "../../src/modules/products/index.js";
import { migrateThrough, upgradeToLatest } from "./setup/historical-upgrade.js";
import {
  createTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

let database: TestDatabase;
beforeAll(async () => {
  database = await createTestDatabase();
});
afterAll(async () => {
  await database.dispose();
});

test("contract preserves Product identities while retiring physical Series and Member Profile names", async () => {
  await migrateThrough(database, "0111_legacy_practice_tasks");
  const productId = randomUUID();
  await database.prisma.$executeRaw(
    Prisma.sql`insert into products.series(id,slug,name,source_id) values (${productId}::uuid,'contract-product','Preserved Product','opaque:series-source-id')`,
  );
  await upgradeToLatest(database);
  expect(
    await database.prisma.$queryRaw(Prisma.sql`
    select to_regclass('products.series')::text as old_product,
      to_regclass('products.products')::text as product,
      to_regclass('products.product_memberships')::text as catalogue,
      to_regclass('products.published_material_product_memberships')::text as published_catalogue,
      to_regclass('products.home_product_pin')::text as home_pin,
      to_regnamespace('member_profiles')::text as old_profiles,
      to_regnamespace('account_profiles')::text as profiles
  `),
  ).toEqual([
    {
      old_product: null,
      product: "products.products",
      catalogue: "products.product_memberships",
      published_catalogue: "products.published_material_product_memberships",
      home_pin: "products.home_product_pin",
      old_profiles: null,
      profiles: "account_profiles",
    },
  ]);
  expect(
    await database.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, slug: true, sourceId: true },
    }),
  ).toEqual({
    id: productId,
    slug: "contract-product",
    sourceId: "opaque:series-source-id",
  });
  const owner = new ProductDiscovery(database.prisma);
  expect(await owner.metadata({ ids: [productId] })).toMatchObject([
    { id: productId, name: "Preserved Product" },
  ]);
});
