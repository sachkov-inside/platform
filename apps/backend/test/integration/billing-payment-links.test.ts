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
test("Payment Link issued for an unpublished price is quoted at its saved price: a private sale needs no public price", async () => {
  const s = await world.scenario();
  value(
    await s.pricing.manage(world.owner, {
      operation: "productPrices.save",
      operationId: randomUUID(),
      expectedRevision: 1,
      value: {
        productId: s.productId,
        name: "Курс",
        priceKopecks: 200000,
        published: false,
      },
    }),
  );
  const link = value(
    await s.pricing.managePaymentLink(world.owner, {
      operation: "paymentLinks.create",
      operationId: randomUUID(),
      productId: s.productId,
      priceRevision: 2,
      price: { kind: "discount", percent: 10 },
      expiresAt: null,
    }),
  );
  const other = await world.scenario();
  const quote = value(
    await s.pricing.quote(other.buyer, {
      operationId: randomUUID(),
      productId: s.productId,
      priceRevision: 2,
      paymentLinkId: link.id,
    }),
  );
  expect(quote.snapshot.firstPriceKopecks).toBe(180000);
});
test("price edits and publication changes leave a Payment Link payable at its saved price", async () => {
  const s = await world.scenario();
  const link = value(
    await s.pricing.managePaymentLink(world.owner, {
      operation: "paymentLinks.create",
      operationId: randomUUID(),
      productId: s.productId,
      priceRevision: 1,
      price: { kind: "amount", amountKopecks: 150000 },
      expiresAt: null,
    }),
  );
  for (const [expectedRevision, priceKopecks, published] of [
    [1, 300000, false],
    [2, 250000, true],
    [3, 90000, false],
  ] as const)
    value(
      await s.pricing.manage(world.owner, {
        operation: "productPrices.save",
        operationId: randomUUID(),
        expectedRevision,
        value: {
          productId: s.productId,
          name: "Курс",
          priceKopecks,
          published,
        },
      }),
    );
  const buyer = await world.scenario({
    productId: s.productId,
    paymentLinkId: link.id,
  });
  const purchase = value(
    await buyer.payments.purchase(buyer.buyer, buyer.command),
  );
  expect(purchase.snapshot.firstPriceKopecks).toBe(150000);
});
test("archiving the price closes the sale for its Payment Links", async () => {
  const s = await world.scenario();
  const link = value(
    await s.pricing.managePaymentLink(world.owner, {
      operation: "paymentLinks.create",
      operationId: randomUUID(),
      productId: s.productId,
      priceRevision: 1,
      price: { kind: "discount", percent: 10 },
      expiresAt: null,
    }),
  );
  value(
    await s.pricing.manage(world.owner, {
      operation: "productPrices.archive",
      operationId: randomUUID(),
      expectedRevision: 1,
      id: s.productId,
    }),
  );
  const other = await world.scenario();
  expect(
    await s.pricing.quote(other.buyer, {
      operationId: randomUUID(),
      productId: s.productId,
      priceRevision: 1,
      paymentLinkId: link.id,
    }),
  ).toMatchObject({ ok: false });
  expect(value(await s.pricing.paymentLink(link.id)).state).toBe("changed");
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

const defaultNow = new Date("2030-01-31T10:00:00Z");

async function createLink(
  s: Awaited<ReturnType<typeof world.scenario>>,
  at: string,
  expiresAt: string | null = null,
) {
  world.setTime(new Date(at));
  return value(
    await s.pricing.managePaymentLink(world.owner, {
      operation: "paymentLinks.create",
      operationId: randomUUID(),
      productId: s.productId,
      priceRevision: 1,
      price: { kind: "discount", percent: 10 },
      expiresAt,
    }),
  );
}

test("paymentLinks.list narrows by Product and visible state, newest first, with a cursor bound to its whole filter", async () => {
  try {
    const s = await world.scenario();
    const other = await world.scenario();
    const oldest = await createLink(s, "2030-02-01T10:00:00Z");
    const expiring = await createLink(
      s,
      "2030-02-02T10:00:00Z",
      "2030-02-02T11:00:00Z",
    );
    const revoked = await createLink(s, "2030-02-03T10:00:00Z");
    const reserved = await createLink(s, "2030-02-04T10:00:00Z");
    const newest = await createLink(s, "2030-02-05T10:00:00Z");
    await createLink(other, "2030-02-05T10:00:00Z");
    value(
      await s.pricing.managePaymentLink(world.owner, {
        operation: "paymentLinks.revoke",
        operationId: randomUUID(),
        id: revoked.id,
        expectedRevision: revoked.revision,
      }),
    );
    const buyer = await world.scenario({
      productId: s.productId,
      paymentLinkId: reserved.id,
    });
    value(await buyer.payments.purchase(buyer.buyer, buyer.command));
    world.setTime(new Date("2030-02-06T10:00:00Z"));

    const list = async (filter: Record<string, unknown>) => {
      const result = await s.pricing.paymentLinks(world.owner, filter);
      if (!result.ok) throw new Error(result.error.code);
      return {
        ids: result.value.items.map((item) => [item.id, item.state]),
        nextCursor: result.value.nextCursor,
      };
    };
    expect(await list({ productId: s.productId })).toEqual({
      ids: [
        [newest.id, "active"],
        [reserved.id, "pending"],
        [revoked.id, "revoked"],
        [expiring.id, "expired"],
        [oldest.id, "active"],
      ],
      nextCursor: null,
    });
    for (const [state, expected] of [
      ["active", [newest.id, oldest.id]],
      ["pending", [reserved.id]],
      ["revoked", [revoked.id]],
      ["expired", [expiring.id]],
      ["paid", []],
      ["unknown", []],
      ["changed", []],
    ] as const)
      expect(
        (await list({ productId: s.productId, state })).ids.map(([id]) => id),
      ).toEqual(expected);

    const firstPage = await list({ productId: s.productId, limit: 2 });
    expect(firstPage.ids).toEqual([
      [newest.id, "active"],
      [reserved.id, "pending"],
    ]);
    const cursor = firstPage.nextCursor ?? "";
    expect(cursor).not.toBe("");
    const secondPage = await list({
      productId: s.productId,
      limit: 2,
      cursor,
    });
    expect(secondPage.ids).toEqual([
      [revoked.id, "revoked"],
      [expiring.id, "expired"],
    ]);
    expect(
      (
        await list({
          productId: s.productId,
          limit: 2,
          cursor: secondPage.nextCursor,
        })
      ).ids,
    ).toEqual([[oldest.id, "active"]]);
    const activeFirst = await list({
      productId: s.productId,
      state: "active",
      limit: 1,
    });
    expect(activeFirst.ids).toEqual([[newest.id, "active"]]);
    // The cursor continues its list even after the row it stopped at left the filter.
    value(
      await s.pricing.managePaymentLink(world.owner, {
        operation: "paymentLinks.revoke",
        operationId: randomUUID(),
        id: newest.id,
        expectedRevision: newest.revision,
      }),
    );
    expect(
      await list({
        productId: s.productId,
        state: "active",
        limit: 1,
        cursor: activeFirst.nextCursor,
      }),
    ).toEqual({ ids: [[oldest.id, "active"]], nextCursor: null });
    // A cursor continues only its own filter: another Product, another state or none at all.
    for (const filter of [
      { productId: other.productId, cursor },
      { productId: s.productId, state: "active", cursor },
      { cursor },
      {
        productId: s.productId,
        state: "pending",
        cursor: activeFirst.nextCursor,
      },
      { productId: s.productId, cursor: randomUUID() },
      { productId: s.productId, cursor: "bm90LWpzb24" },
      { productId: s.productId, cursor: "!" },
      { state: "archived" },
    ])
      expect(
        await s.pricing.paymentLinks(world.owner, filter),
        JSON.stringify(filter),
      ).toEqual({
        ok: false,
        error: { code: "invalid_request" },
      });
  } finally {
    world.setTime(defaultNow);
  }
});

test("a Payment Link of a Product whose price was archived reads and filters as changed", async () => {
  try {
    const s = await world.scenario();
    const link = await createLink(s, "2030-02-01T10:00:00Z");
    value(
      await s.pricing.manage(world.owner, {
        operation: "productPrices.archive",
        operationId: randomUUID(),
        id: s.productId,
        expectedRevision: 1,
      }),
    );
    const changed = await s.pricing.paymentLinks(world.owner, {
      productId: s.productId,
      state: "changed",
    });
    expect(changed).toMatchObject({
      ok: true,
      value: { items: [{ id: link.id, state: "changed" }], nextCursor: null },
    });
    expect(
      await s.pricing.paymentLinks(world.owner, {
        productId: s.productId,
        state: "active",
      }),
    ).toEqual({ ok: true, value: { items: [], nextCursor: null } });
  } finally {
    world.setTime(defaultNow);
  }
});
