import { afterAll, beforeAll, expect, test } from "vitest";
import { BillingPayments } from "../../src/modules/billing/index.js";
import { Tbank } from "../../src/modules/billing/infrastructure/tbank/tbank.js";
import { localTbankConfig } from "../../src/config/tbank-config.js";
import { createLocalBankDouble } from "../../src/development/bank-double/local-bank-double.js";
import { CoverageCatalog } from "../../src/modules/materials/facets/coverage-catalog/coverage-catalog.js";
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
test.each([
  ["confirmed", "confirmed"],
  ["rejected", "failed"],
  ["canceled", "failed"],
  ["expired", "failed"],
] as const)(
  "local bank form %s reaches the real Product buyer boundary as %s",
  async (outcome, state) => {
    const s = await world.scenario();
    const config = localTbankConfig({});
    const double = createLocalBankDouble({
      config,
      notify: async (_url, payload) => {
        const result = await payments.notification(payload);
        if (!result.ok) throw new Error(result.error.code);
      },
    });
    const bank = new Tbank(config, (url, init) =>
      double.handle(
        new Request(url, {
          method: init.method,
          headers: init.headers,
          body: init.body,
        }),
      ),
    );
    const payments = new BillingPayments({
      prisma: world.db.prisma,
      bank,
      contact: s.contact,
      grants: s.grants,
      clock: () => new Date("2030-01-31T10:00:00Z"),
      contentCatalog: new CoverageCatalog(
        world.db.prisma,
        new ProductDiscovery(world.db.prisma),
      ),
    });
    const purchase = value(await payments.purchase(s.buyer, s.command));
    if (purchase.paymentUrl === null) throw new Error("Missing bank form");
    expect(
      (
        await double.handle(
          new Request(purchase.paymentUrl, {
            method: "POST",
            body: new URLSearchParams({ outcome }),
          }),
        )
      ).status,
    ).toBeLessThan(400);
    await payments.recover();
    expect(
      value(await payments.status(s.buyer, purchase.purchaseRef)).state,
    ).toBe(state);
    const right = await s.grants.readProductAccess(world.owner, {
      accountId: s.buyer,
      productId: s.productId,
    });
    expect(right.ok).toBe(outcome === "confirmed");
  },
);
