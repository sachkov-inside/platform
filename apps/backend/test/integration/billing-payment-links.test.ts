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

test("paymentLinks.list narrows by Product and visible state, newest first, with a cursor bound to its Product", async () => {
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
    const foreign = await createLink(other, "2030-02-05T10:00:00Z");
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
    expect(firstPage).toEqual({
      ids: [
        [newest.id, "active"],
        [reserved.id, "pending"],
      ],
      nextCursor: reserved.id,
    });
    expect(
      await list({ productId: s.productId, limit: 2, cursor: reserved.id }),
    ).toEqual({
      ids: [
        [revoked.id, "revoked"],
        [expiring.id, "expired"],
      ],
      nextCursor: expiring.id,
    });
    for (const filter of [
      { productId: s.productId, cursor: foreign.id },
      { productId: s.productId, cursor: randomUUID() },
      { state: "archived" },
    ])
      expect(await s.pricing.paymentLinks(world.owner, filter)).toEqual({
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
