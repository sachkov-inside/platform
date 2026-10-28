import { BillingOperations } from "../../src/modules/billing/index.js";
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

async function operations() {
  const s = await world.scenario();
  return {
    s,
    owner: new BillingOperations({
      prisma: world.db.prisma,
      accounts: s.accounts,
      pricing: s.pricing,
      payments: s.payments,
      grants: s.grants,
      bank: s.bank,
    }),
  };
}
test("owner reads exact bank history while a buyer cannot use owner operations", async () => {
  const { s, owner } = await operations();
  const purchase = value(await s.payments.purchase(s.buyer, s.command));
  await s.notify("CONFIRMED");
  await s.payments.recover();
  const command = {
    operation: "payments.read",
    operationId: randomUUID(),
    purchaseRef: purchase.purchaseRef,
  };
  expect(await owner.execute(s.buyer, command)).toMatchObject({
    ok: false,
    error: { code: "forbidden" },
  });
  const read = await owner.execute(world.owner, command);
  expect(read).toMatchObject({ ok: true });
  expect(JSON.stringify(read)).not.toContain(s.config.password);
  expect(JSON.stringify(read)).not.toContain(s.config.bindingEncryptionKey);
});
test.each([
  "refunds.decide",
  "refunds.execute",
  "enrollments.assign",
  "tiers.save",
  "tribute.import",
  "invitations.create",
])(
  "removed owner operation %s cannot start an external operation",
  async (operation) => {
    const { s, owner } = await operations();
    expect(
      await owner.execute(world.owner, {
        operation,
        operationId: randomUUID(),
        purchaseRef: randomUUID(),
        amountKopecks: 200000,
        reason: "Rejected obsolete operation",
      }),
    ).toMatchObject({ ok: false, error: { code: "invalid_request" } });
    expect(s.initCalls()).toBe(0);
  },
);

test("scoped Billing permission admits owner reads while Materials permission stays denied", async () => {
  const { s, owner } = await operations();
  const purchase = value(await s.payments.purchase(s.buyer, s.command));
  for (const permission of ["materials:manage", "billing:manage"] as const) {
    const actor = randomUUID();
    await world.db.prisma.account.create({
      data: {
        id: actor,
        logtoIssuer: "https://identity.invalid",
        logtoSubject: actor,
      },
    });
    await world.db.prisma.accountPermission.create({
      data: { accountId: actor, permission },
    });
    const read = await owner.execute(actor, {
      operation: "payments.read",
      operationId: randomUUID(),
      purchaseRef: purchase.purchaseRef,
    });
    expect(read.ok).toBe(permission === "billing:manage");
    if (permission === "materials:manage")
      expect(read).toMatchObject({ error: { code: "forbidden" } });
  }
});

test("one owner operation id cannot cross command families or repeat a changed Product price", async () => {
  const { s, owner } = await operations();
  const operationId = randomUUID();
  const command = {
    operation: "productPrices.save",
    operationId,
    expectedRevision: 1,
    value: {
      productId: s.productId,
      name: "Operation receipt Product",
      priceKopecks: 250000,
      published: true,
    },
  };
  const first = await owner.execute(world.owner, command);
  expect(first).toMatchObject({ ok: true });
  expect(await owner.execute(world.owner, command)).toEqual(first);
  expect(
    await owner.execute(world.owner, {
      operation: "promotions.save",
      operationId,
      value: {
        id: randomUUID(),
        name: "Conflicting family",
        percent: 10,
        code: null,
        startsAt: "2020-01-01T00:00:00Z",
        endsAt: "2040-01-01T00:00:00Z",
        productIds: [s.productId],
        usageLimit: null,
      },
    }),
  ).toMatchObject({ ok: false, error: { code: "operation_conflict" } });
  expect(
    await owner.execute(world.owner, {
      ...command,
      value: { ...command.value, priceKopecks: 300000 },
    }),
  ).toMatchObject({ ok: false, error: { code: "operation_conflict" } });
  expect(
    value(
      await s.pricing.quote(s.buyer, {
        operationId: randomUUID(),
        productId: s.productId,
        priceRevision: 2,
      }),
    ).snapshot.firstPriceKopecks,
  ).toBe(250000);
});

test("productPrices.list reads one Product's price when asked by productId", async () => {
  const { s, owner } = await operations();
  await world.scenario();
  const result = await owner.execute(world.owner, {
    operation: "productPrices.list",
    operationId: randomUUID(),
    productId: s.productId,
  });
  if (!result.ok || result.result.outcome !== "catalogOffers")
    throw new Error(JSON.stringify(result));
  expect(result.result.nextCursor).toBeNull();
  expect(result.result.items.map((item) => item.product?.id)).toEqual([
    s.productId,
  ]);
});

test("productPrices.list tells the owner a Product's price is archived, which no save restores or replaces", async () => {
  const { s, owner } = await operations();
  value(
    await s.pricing.manage(world.owner, {
      operation: "productPrices.archive",
      operationId: randomUUID(),
      id: s.productId,
      expectedRevision: 1,
    }),
  );
  const read = async (filter: Record<string, unknown>) => {
    const result = await owner.execute(world.owner, {
      operation: "productPrices.list",
      operationId: randomUUID(),
      ...filter,
    });
    if (!result.ok || result.result.outcome !== "catalogOffers")
      throw new Error(JSON.stringify(result));
    return result.result;
  };
  expect(await read({ productId: s.productId })).toMatchObject({
    items: [],
    archivedProductIds: [s.productId],
    nextCursor: null,
  });
  // The whole catalog walks archived prices too: none of them is an item.
  const pages = [];
  let cursor: string | null | undefined;
  do {
    const page = await read({
      limit: 2,
      ...(cursor == null ? {} : { cursor }),
    });
    pages.push(page);
    cursor = page.nextCursor;
  } while (cursor !== null);
  expect(pages.flatMap((page) => page.archivedProductIds)).toContain(
    s.productId,
  );
  expect(
    pages.flatMap((page) => page.items.map((item) => item.product?.id)),
  ).not.toContain(s.productId);
  // The archive is final: neither a new price nor opening sales comes back.
  for (const published of [false, true])
    expect(
      await s.pricing.manage(world.owner, {
        operation: "productPrices.save",
        operationId: randomUUID(),
        expectedRevision: 2,
        value: {
          productId: s.productId,
          name: "Курс",
          priceKopecks: 300000,
          published,
        },
      }),
    ).toEqual({ ok: false, error: { code: "not_found" } });
  // The public catalog still lists only prices on sale, without the archive.
  const offers = value(await s.pricing.offers({ productId: s.productId }));
  expect(offers).toEqual({ items: [], nextCursor: null });
});

test.each([
  ["payments.list", { productId: randomUUID(), states: ["confirmed"] }],
  ["paymentLinks.list", { productId: randomUUID(), state: "active" }],
  ["productPrices.list", { productId: randomUUID() }],
  ["promotions.list", { archived: true }],
])(
  "%s refuses Materials-only and rightless accounts instead of answering empty",
  async (operation, filter) => {
    const { owner } = await operations();
    for (const permission of ["materials:manage", null] as const) {
      const actor = randomUUID();
      await world.db.prisma.account.create({
        data: {
          id: actor,
          logtoIssuer: "https://identity.invalid",
          logtoSubject: actor,
        },
      });
      if (permission !== null)
        await world.db.prisma.accountPermission.create({
          data: { accountId: actor, permission },
        });
      expect(
        await owner.execute(actor, {
          operation,
          operationId: randomUUID(),
          ...filter,
        }),
      ).toEqual({ ok: false, error: { code: "forbidden" } });
    }
  },
);
