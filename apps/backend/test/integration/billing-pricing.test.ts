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

test("Product prices require current owner permission on first write and replay", async () => {
  const s = await world.scenario();
  const command = {
    operation: "productPrices.save",
    operationId: randomUUID(),
    expectedRevision: 1,
    value: {
      productId: s.productId,
      name: "New",
      priceKopecks: 250000,
      published: true,
    },
  };
  expect(await s.pricing.manage(s.buyer, command)).toMatchObject({
    ok: false,
    error: { code: "forbidden" },
  });
  expect(await s.pricing.manage(world.owner, command)).toMatchObject({
    ok: true,
  });
  await world.db.prisma.accountPermission.delete({
    where: {
      accountId_permission: {
        accountId: world.owner,
        permission: "platform:admin",
      },
    },
  });
  expect(await s.pricing.manage(world.owner, command)).toMatchObject({
    ok: false,
    error: { code: "forbidden" },
  });
  await world.db.prisma.accountPermission.create({
    data: { accountId: world.owner, permission: "platform:admin" },
  });
});
test("concurrent optimistic price edits serialize and stale quote cannot start a payment", async () => {
  const s = await world.scenario();
  const input = {
    operation: "productPrices.save",
    expectedRevision: 1,
    value: {
      productId: s.productId,
      name: "Updated",
      priceKopecks: 250000,
      published: true,
    },
  };
  const results = await Promise.all([
    s.pricing.manage(world.owner, { ...input, operationId: randomUUID() }),
    s.pricing.manage(world.owner, { ...input, operationId: randomUUID() }),
  ]);
  expect(results.filter((r) => r.ok)).toHaveLength(1);
  expect(results.find((r) => !r.ok)).toMatchObject({
    error: { code: "revision_conflict" },
  });
  expect(await s.payments.purchase(s.buyer, s.command)).toMatchObject({
    ok: false,
    error: { code: "quote_changed" },
  });
  expect(s.initCalls()).toBe(0);
});
test.each([0, -1, 1.5])(
  "invalid Product price %s is rejected without replacing accepted terms",
  async (priceKopecks) => {
    const s = await world.scenario();
    expect(
      await s.pricing.manage(world.owner, {
        operation: "productPrices.save",
        operationId: randomUUID(),
        expectedRevision: 1,
        value: {
          productId: s.productId,
          name: "Bad",
          priceKopecks,
          published: true,
        },
      }),
    ).toMatchObject({ ok: false, error: { code: "invalid_request" } });
    expect(
      value(
        await s.pricing.quote(s.buyer, {
          operationId: randomUUID(),
          productId: s.productId,
          priceRevision: 1,
        }),
      ).snapshot.firstPriceKopecks,
    ).toBe(200000);
  },
);
test("a quote is Account-bound and its exact replay retains immutable accepted price", async () => {
  const s = await world.scenario();
  const command = {
    operationId: randomUUID(),
    productId: s.productId,
    priceRevision: 1,
  };
  const quote = value(await s.pricing.quote(s.buyer, command));
  expect(value(await s.pricing.quote(s.buyer, command))).toEqual(quote);
  const other = await world.scenario();
  expect(
    await s.payments.purchase(other.buyer, {
      ...s.command,
      quoteRef: quote.quoteRef,
    }),
  ).toMatchObject({ ok: false });
  expect(s.initCalls()).toBe(0);
});
