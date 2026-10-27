import { BillingOperations } from "../../src/modules/billing/index.js";
import type { OwnerResult } from "../../src/modules/billing/domain/owner-operations.js";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createQueryEventClient } from "./setup/query-events.js";
import {
  createProductCommerceWorld,
  commerceValue as value,
} from "./setup/product-commerce.js";
let world: Awaited<ReturnType<typeof createProductCommerceWorld>>;
beforeAll(async () => {
  world = await createProductCommerceWorld();
});
afterAll(async () => world.dispose());

type Scenario = Awaited<ReturnType<typeof world.scenario>>;
function ownerOperations(s: Scenario) {
  return new BillingOperations({
    prisma: world.db.prisma,
    accounts: s.accounts,
    pricing: s.pricing,
    payments: s.payments,
    grants: s.grants,
    bank: s.bank,
  });
}

async function savePromotion(
  s: Scenario,
  value_: {
    readonly name: string;
    readonly startsAt: string;
    readonly productIds: readonly string[];
    readonly code?: string;
  },
) {
  const id = randomUUID();
  value(
    await s.pricing.manage(world.owner, {
      operation: "promotions.save",
      operationId: randomUUID(),
      value: {
        id,
        name: value_.name,
        percent: 15,
        code: value_.code ?? null,
        startsAt: value_.startsAt,
        endsAt: "2040-01-01T00:00:00.000Z",
        productIds: value_.productIds,
        usageLimit: 10,
      },
    }),
  );
  return id;
}

async function listPromotions(
  owner: BillingOperations,
  actor: string,
  filter: Record<string, unknown>,
) {
  return await owner.execute(actor, {
    operation: "promotions.list",
    operationId: randomUUID(),
    ...filter,
  });
}

function itemsOf(result: OwnerResult) {
  if (!result.ok || result.result.outcome !== "promotions")
    throw new Error(JSON.stringify(result));
  return result.result;
}

test("promotions.list reads owner Promotions newest first with usage counted like the usage limit", async () => {
  // The scenario's Promotion is used by its own purchase; a second, failed purchase is not counted.
  const s = await world.scenario({ discount: 20, usageLimit: 5 });
  const promotionId = (
    await world.db.prisma.billingPromotion.findFirstOrThrow({
      where: { productIds: { has: s.productId } },
    })
  ).id;
  value(await s.payments.purchase(s.buyer, s.command));
  const failed = await world.scenario({ productId: s.productId });
  value(await failed.payments.purchase(failed.buyer, failed.command));
  await failed.notify("REJECTED");
  const everyProduct = await savePromotion(s, {
    name: "Для всех продуктов",
    startsAt: "2030-01-01T00:00:00.000Z",
    productIds: [],
  });
  const archived = await savePromotion(s, {
    name: "Архивная",
    startsAt: "2029-01-01T00:00:00.000Z",
    productIds: [s.productId],
  });
  value(
    await s.pricing.manage(world.owner, {
      operation: "promotions.archive",
      operationId: randomUUID(),
      id: archived,
      expectedRevision: 1,
    }),
  );
  const owner = ownerOperations(s);

  const current = itemsOf(await listPromotions(owner, world.owner, {}));
  expect(current.items.map((item) => item.id)).toEqual([
    everyProduct,
    promotionId,
  ]);
  expect(current.items[1]).toMatchObject({
    id: promotionId,
    name: "Скидка",
    percent: 20,
    productIds: [s.productId],
    usageLimit: 5,
    archived: false,
    revision: 1,
    usedCount: 1,
    questionnaire: false,
    legacy: false,
  });
  expect(current.items[0]).toMatchObject({ usedCount: 0, productIds: [] });
  expect(current.nextCursor).toBeNull();
  expect(
    itemsOf(
      await listPromotions(owner, world.owner, { archived: true }),
    ).items.map((item) => item.id),
  ).toEqual([archived]);

  const first = itemsOf(await listPromotions(owner, world.owner, { limit: 1 }));
  expect(first.items.map((item) => item.id)).toEqual([everyProduct]);
  const cursor = first.nextCursor ?? "";
  expect(cursor).not.toBe("");
  // The cursor continues its list even after the row it stopped at left the filter.
  value(
    await s.pricing.manage(world.owner, {
      operation: "promotions.archive",
      operationId: randomUUID(),
      id: everyProduct,
      expectedRevision: 1,
    }),
  );
  const second = itemsOf(
    await listPromotions(owner, world.owner, { limit: 1, cursor }),
  );
  expect(second.items.map((item) => item.id)).toEqual([promotionId]);
  expect(second.nextCursor).toBeNull();
  // A cursor continues only its own filter: archive, Product and questionnaire side all count.
  for (const filter of [
    { archived: true, cursor },
    { productId: s.productId, cursor },
    { questionnaire: true, cursor },
    { cursor: randomUUID() },
    { cursor: "bm90LWpzb24" },
    { cursor: "!" },
  ])
    expect(
      await listPromotions(owner, world.owner, filter),
      JSON.stringify(filter),
    ).toEqual({ ok: false, error: { code: "invalid_request" } });
});

test("promotions.list keeps questionnaire Promotions apart and flags a migrated legacy scope", async () => {
  const s = await world.scenario();
  const owner = ownerOperations(s);
  const template = await savePromotion(s, {
    name: "Анкетная",
    startsAt: "2031-01-01T00:00:00.000Z",
    productIds: [s.productId],
    code: `survey-${randomUUID()}`,
  });
  await world.db.prisma.billingSurveyRespondent.create({
    data: {
      username: `respondent_${randomUUID().slice(0, 8)}`,
      importedAt: new Date("2030-01-01T00:00:00Z"),
      promotionId: template,
      issuedAt: new Date("2030-01-02T00:00:00Z"),
    },
  });
  // A Promotion that migration 0108 could not move from old offers to Products.
  const legacy = randomUUID();
  await world.db.prisma.billingPromotion.create({
    data: {
      id: legacy,
      revision: 3,
      name: "Прежняя скидка на тариф",
      percent: 30,
      startsAt: new Date("2025-01-01T00:00:00Z"),
      endsAt: new Date("2025-06-01T00:00:00Z"),
      legacyOfferIds: [randomUUID()],
      archived: true,
    },
  });
  const named = await savePromotion(s, {
    name: "Только этот продукт",
    startsAt: "2031-02-01T00:00:00.000Z",
    productIds: [s.productId],
  });

  const questionnaire = itemsOf(
    await listPromotions(owner, world.owner, { questionnaire: true }),
  );
  expect(questionnaire.items).toEqual([
    expect.objectContaining({ id: template, questionnaire: true }),
  ]);
  const ordinary = itemsOf(await listPromotions(owner, world.owner, {}));
  expect(ordinary.items.map((item) => item.id)).not.toContain(template);
  expect(ordinary.items.map((item) => item.id)).toContain(named);

  const archived = itemsOf(
    await listPromotions(owner, world.owner, { archived: true }),
  );
  expect(archived.items.find((item) => item.id === legacy)).toMatchObject({
    legacy: true,
    productIds: [],
  });
  expect(
    archived.items.filter((item) => item.id !== legacy),
  ).not.toContainEqual(expect.objectContaining({ legacy: true }));

  // A Product filter reads the Promotions that apply to it: named ones and those for every Product.
  const forProduct = itemsOf(
    await listPromotions(owner, world.owner, { productId: s.productId }),
  );
  expect(forProduct.items.map((item) => item.id)).toContain(named);
  expect(
    forProduct.items.every(
      (item) =>
        item.productIds.length === 0 || item.productIds.includes(s.productId),
    ),
  ).toBe(true);
  expect(
    itemsOf(
      await listPromotions(owner, world.owner, {
        archived: true,
        productId: s.productId,
      }),
    ).items.map((item) => item.id),
  ).not.toContain(legacy);
});

test("promotions.list refuses an account without billing:manage instead of answering empty", async () => {
  const s = await world.scenario();
  const owner = ownerOperations(s);
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
    expect(await listPromotions(owner, actor, {})).toEqual({
      ok: false,
      error: { code: "forbidden" },
    });
  }
  const billing = randomUUID();
  await world.db.prisma.account.create({
    data: {
      id: billing,
      logtoIssuer: "https://identity.invalid",
      logtoSubject: billing,
    },
  });
  await world.db.prisma.accountPermission.create({
    data: { accountId: billing, permission: "billing:manage" },
  });
  expect(await listPromotions(owner, billing, {})).toMatchObject({ ok: true });
});

test("promotions.list reads a page and its usage in a fixed number of statements", async () => {
  const s = await world.scenario();
  for (const index of [1, 2, 3, 4, 5])
    await savePromotion(s, {
      name: `Скидка ${String(index)}`,
      startsAt: `2032-0${String(index)}-01T00:00:00.000Z`,
      productIds: [s.productId],
    });
  const observer = createQueryEventClient(world.db.url);
  try {
    const owner = new BillingOperations({
      prisma: observer.prisma,
      accounts: s.accounts,
      pricing: s.pricing,
      payments: s.payments,
      grants: s.grants,
      bank: s.bank,
    });
    const one = await observer.measure(() =>
      listPromotions(owner, world.owner, { productId: s.productId, limit: 1 }),
    );
    const five = await observer.measure(() =>
      listPromotions(owner, world.owner, { productId: s.productId, limit: 5 }),
    );
    expect(itemsOf(five.result).items).toHaveLength(5);
    // The page and one grouped usage count, however many Promotions the page holds.
    expect(five.statements).toHaveLength(2);
    expect(one.statements).toHaveLength(five.statements.length);
  } finally {
    await observer.prisma.$disconnect();
  }
});
