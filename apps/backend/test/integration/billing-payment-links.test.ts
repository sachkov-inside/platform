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

test("Payment Link retains saved kopeck price across current catalogue edits and can be used by another Account", async () => {
  const s = await world.scenario();
  const link = value(
    await s.pricing.managePaymentLink(world.owner, {
      operation: "paymentLinks.create",
      operationId: randomUUID(),
      productId: s.productId,
      priceRevision: 1,
      price: { kind: "amount", amountKopecks: 123456 },
      expiresAt: null,
    }),
  );
  value(
    await s.pricing.manage(world.owner, {
      operation: "productPrices.save",
      operationId: randomUUID(),
      expectedRevision: 1,
      value: {
        productId: s.productId,
        name: "New",
        priceKopecks: 300000,
        published: true,
      },
    }),
  );
  const other = await world.scenario();
  const quote = value(
    await s.pricing.quote(other.buyer, {
      operationId: randomUUID(),
      productId: s.productId,
      priceRevision: 1,
      paymentLinkId: link.id,
    }),
  );
  expect(quote.snapshot.firstPriceKopecks).toBe(123456);
  expect(quote.snapshot.individualPayment?.linkId).toBe(link.id);
});
test("link creation is owner-authorized and exact replay is stable", async () => {
  const s = await world.scenario();
  const command = {
    operation: "paymentLinks.create",
    operationId: randomUUID(),
    productId: s.productId,
    priceRevision: 1,
    price: { kind: "amount", amountKopecks: 100000 },
    expiresAt: null,
  };
  expect(await s.pricing.managePaymentLink(s.buyer, command)).toMatchObject({
    ok: false,
    error: { code: "forbidden" },
  });
  const first = await s.pricing.managePaymentLink(world.owner, command);
  expect(first).toMatchObject({ ok: true });
  expect(await s.pricing.managePaymentLink(world.owner, command)).toEqual(
    first,
  );
  expect(
    await s.pricing.managePaymentLink(world.owner, {
      ...command,
      price: { kind: "amount", amountKopecks: 110000 },
    }),
  ).toMatchObject({ ok: false, error: { code: "operation_conflict" } });
});
