import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import {
  createProductCommerceWorld,
  commerceValue as value,
} from "./setup/product-commerce.js";
let world: Awaited<ReturnType<typeof createProductCommerceWorld>>;
beforeAll(async () => {
  world = await createProductCommerceWorld();
});
afterAll(async () => world.dispose());

test("a closed Product forbids a new payment while preserving the holder's lifetime access", async () => {
  const s = await world.scenario();
  const purchase = value(await s.payments.purchase(s.buyer, s.command));
  await s.notify("CONFIRMED");
  await s.payments.recover();
  value(
    await s.pricing.manage(world.owner, {
      operation: "productPrices.save",
      operationId: randomUUID(),
      expectedRevision: 1,
      value: {
        productId: s.productId,
        name: "Closed",
        priceKopecks: 200000,
        published: false,
      },
    }),
  );
  expect(
    value(await s.payments.status(s.buyer, purchase.purchaseRef)).access,
  ).toBe("ready");
  expect(
    await s.pricing.quote(s.buyer, {
      operationId: randomUUID(),
      productId: s.productId,
      priceRevision: 2,
    }),
  ).toMatchObject({ ok: false, error: { code: "not_found" } });
});
