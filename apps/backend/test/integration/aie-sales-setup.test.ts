import { readFile } from "node:fs/promises";
import { z } from "zod";
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
test("historical AIE catalogue commands cannot enable tariffs or payment options in current Product commerce", async () => {
  const pricing = new BillingPricing({
    prisma: world.db.prisma,
    accounts: assembleAccounts({
      prisma: world.db.prisma,
      emailFingerprintKey: "aie-historical-command-fingerprint-key",
    }),
    contentCatalog: new CoverageCatalog(
      world.db.prisma,
      new ProductDiscovery(world.db.prisma),
    ),
    sale: { payments: true },
  });
  for (const name of ["prepare", "open-after-go"]) {
    const raw: unknown = JSON.parse(
      await readFile(
        new URL(
          `../../../../docs/evidence/issue-1359/${name}.json`,
          import.meta.url,
        ),
        "utf8",
      ),
    );
    for (const command of z.array(z.unknown()).parse(raw))
      expect(await pricing.manage(world.owner, command)).toMatchObject({
        ok: false,
      });
  }
  expect(await pricing.offers({})).toMatchObject({
    ok: true,
    value: { items: [] },
  });
});
