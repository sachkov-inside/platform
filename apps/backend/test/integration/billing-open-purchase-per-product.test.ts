import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import {
  createProductCommerceWorld,
  commerceValue as value,
} from "./setup/product-commerce.js";

// Owner decision 2 of #1921: an Account keeps at most one unfinished purchase per Product (#1924).
let world: Awaited<ReturnType<typeof createProductCommerceWorld>>;
beforeAll(async () => {
  world = await createProductCommerceWorld();
});
afterAll(async () => world.dispose());

type Scenario = Awaited<ReturnType<typeof world.scenario>>;

/** A second published Product at the same price, so the bank double accepts its Init amount. */
async function publishedProduct(s: Scenario): Promise<string> {
  const productId = randomUUID();
  await world.db.prisma.product.create({
    data: { id: productId, name: "Второй курс", slug: productId },
  });
  value(
    await s.pricing.manage(world.owner, {
      operation: "productPrices.save",
      operationId: randomUUID(),
      value: {
        productId,
        name: "Второй курс",
        priceKopecks: 200000,
        published: true,
      },
    }),
  );
  return productId;
}

function openReservations(accountId: string) {
  return world.db.prisma.billingPromoReservation.findMany({
    where: { accountId, state: { in: ["reserved", "sent", "unknown"] } },
    select: { purchaseRef: true },
  });
}

test("an unfinished purchase of one Product does not block the same Account from paying for another Product", async () => {
  const s = await world.scenario();
  const other = await publishedProduct(s);
  const first = value(await s.payments.purchase(s.buyer, s.command));
  expect(first).toMatchObject({ state: "pending" });

  const second = await s.payments.purchase(
    s.buyer,
    await s.commandFor({ productId: other }),
  );

  expect(second).toMatchObject({ ok: true, value: { state: "pending" } });
  expect(value(second).purchaseRef).not.toBe(first.purchaseRef);
  expect(value(second).paymentUrl).not.toBeNull();
  expect(s.initCalls()).toBe(2);
  expect(
    (await openReservations(s.buyer)).map((row) => row.purchaseRef).sort(),
  ).toEqual([first.purchaseRef, value(second).purchaseRef].sort());
});

test("a repeated purchase of the same Product continues its unfinished purchase", async () => {
  const s = await world.scenario();
  const first = value(await s.payments.purchase(s.buyer, s.command));

  const repeated = await s.payments.purchase(
    s.buyer,
    await s.commandFor({ productId: s.productId }),
  );

  expect(repeated).toMatchObject({
    ok: true,
    value: { purchaseRef: first.purchaseRef },
  });
  expect(s.initCalls()).toBe(1);
  expect(await openReservations(s.buyer)).toEqual([
    { purchaseRef: first.purchaseRef },
  ]);
});

test("concurrent purchases of the same Product from two tabs share one purchase and one Init", async () => {
  const s = await world.scenario();
  const second = await s.commandFor({ productId: s.productId });

  const started = await Promise.all([
    s.payments.purchase(s.buyer, s.command),
    s.payments.purchase(s.buyer, second),
  ]);

  expect(started.every((result) => result.ok)).toBe(true);
  const refs = new Set(started.map((result) => value(result).purchaseRef));
  expect(refs.size).toBe(1);
  expect(s.initCalls()).toBe(1);
  expect(await openReservations(s.buyer)).toEqual([
    { purchaseRef: [...refs][0] },
  ]);
});

test("an open reservation of the same Product without a continuable purchase answers payment_in_progress, not a dependency failure", async () => {
  const s = await world.scenario();
  // The internal reserve step leaves an open Product reservation without a purchase row:
  // the purchase cannot continue it, so the database constraint is the only answer.
  expect(
    await s.pricing.reserve({
      accountId: s.buyer,
      purchaseRef: randomUUID(),
      quoteRef: s.command.quoteRef,
      amountLimits: { minimumKopecks: 100, maximumKopecks: 1_000_000 },
    }),
  ).toMatchObject({ ok: true });

  const blocked = await s.payments.purchase(
    s.buyer,
    await s.commandFor({ productId: s.productId }),
  );

  expect(blocked).toEqual({
    ok: false,
    error: { code: "payment_in_progress" },
  });
  expect(s.initCalls()).toBe(0);
  expect(
    await world.db.prisma.billingPurchase.count({
      where: { accountId: s.buyer },
    }),
  ).toBe(0);
  // The internal reserve step answers the same conflict as a reservation conflict.
  const another = await s.commandFor({ productId: s.productId });
  expect(
    await s.pricing.reserve({
      accountId: s.buyer,
      purchaseRef: randomUUID(),
      quoteRef: another.quoteRef,
      amountLimits: { minimumKopecks: 100, maximumKopecks: 1_000_000 },
    }),
  ).toEqual({ ok: false, error: { code: "reservation_conflict" } });
});
