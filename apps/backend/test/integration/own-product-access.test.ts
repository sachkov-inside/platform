import { afterAll, beforeAll, expect, test } from "vitest";
import { CoverageCatalog } from "../../src/modules/materials/facets/coverage-catalog/coverage-catalog.js";
import { ProductDiscovery } from "../../src/modules/products/index.js";
import { assembleAccounts } from "../../src/modules/accounts/index.js";
import { assembleAccessGrants } from "../../src/modules/account-rights/index.js";
import { createProductCommerceWorld } from "./setup/product-commerce.js";
import {
  grantProductFixture,
  revokeProductFixture,
} from "./setup/product-access.js";
let world: Awaited<ReturnType<typeof createProductCommerceWorld>>;
beforeAll(async () => {
  world = await createProductCommerceWorld();
});
afterAll(async () => world.dispose());
test("own Products retain stable names, Account isolation and explicit withdrawn state after archival", async () => {
  const s = await world.scenario(),
    other = await world.scenario();
  const grants = assembleAccessGrants({
    prisma: world.db.prisma,
    accounts: assembleAccounts({
      prisma: world.db.prisma,
      emailFingerprintKey: "own-products-fixture-fingerprint-key-000000",
    }),
    contentCatalog: new CoverageCatalog(
      world.db.prisma,
      new ProductDiscovery(world.db.prisma),
    ),
  });
  const target = await grantProductFixture(
    world.db.prisma,
    s.buyer,
    s.productId,
  );
  expect(await grants.readOwnProducts(s.buyer)).toMatchObject({
    ok: true,
    value: [
      {
        id: s.productId,
        name: "Курс",
        materials: { state: "available" },
        community: { state: "available" },
      },
    ],
  });
  expect(await grants.readOwnProducts(other.buyer)).toEqual({
    ok: true,
    value: [],
  });
  await world.db.prisma.product.update({
    where: { id: s.productId },
    data: { archivedAt: new Date("2030-02-01T00:00:00Z") },
  });
  expect(await grants.readOwnProducts(s.buyer)).toMatchObject({
    ok: true,
    value: [{ id: s.productId, materials: { state: "available" } }],
  });
  await revokeProductFixture(world.db.prisma, target);
  expect(await grants.readOwnProducts(s.buyer)).toMatchObject({
    ok: true,
    value: [
      {
        id: s.productId,
        materials: { state: "revoked" },
        community: { state: "revoked" },
      },
    ],
  });
});
