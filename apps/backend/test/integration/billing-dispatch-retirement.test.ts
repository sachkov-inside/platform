import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { CoverageCatalog } from "../../src/modules/materials/index.js";
import { ProductDiscovery } from "../../src/modules/products/index.js";
import { BillingPayments } from "../../src/modules/billing/index.js";
import {
  createProductCommerceWorld,
  commerceValue as value,
} from "./setup/product-commerce.js";

type World = Awaited<ReturnType<typeof createProductCommerceWorld>>;
type Scenario = Awaited<ReturnType<World["scenario"]>>;
let world: World;
beforeAll(async () => {
  world = await createProductCommerceWorld();
});
afterAll(async () => world.dispose());

/**
 * Покупка сохранена, но Init не ушёл: процесс прервался до отправки в банк. Повтор той же
 * команды или сверка продолжают её через dispatch.
 */
async function interruptedPurchase(s: Scenario): Promise<string> {
  let acquisitionReads = 0;
  const interrupted = new BillingPayments({
    prisma: world.db.prisma,
    bank: s.bank,
    contact: s.contact,
    contentCatalog: new CoverageCatalog(
      world.db.prisma,
      new ProductDiscovery(world.db.prisma),
    ),
    clock: world.time,
    grants: {
      ...s.grants,
      hasProductAcquisition: async (
        ...args: Parameters<typeof s.grants.hasProductAcquisition>
      ) => {
        acquisitionReads += 1;
        // Первое чтение допускает покупку, второе идёт уже из dispatch.
        if (acquisitionReads > 1)
          throw new Error("Synthetic interruption before Init");
        return s.grants.hasProductAcquisition(...args);
      },
    },
  });
  expect(await interrupted.purchase(s.buyer, s.command)).toMatchObject({
    ok: false,
    error: { code: "dependency_unavailable" },
  });
  const row = await world.db.prisma.billingPurchase.findFirstOrThrow({
    where: { accountId: s.buyer },
  });
  expect(row.state).toBe("prepared");
  return row.id;
}

/** Строки журнала уровня warn, записанные за время работы. */
async function warnings<Value>(
  work: () => Promise<Value>,
): Promise<{ readonly result: Value; readonly lines: unknown[] }> {
  const lines: unknown[] = [];
  const warn = vi.spyOn(console, "warn").mockImplementation((line: unknown) => {
    lines.push(JSON.parse(String(line)));
  });
  try {
    return { result: await work(), lines };
  } finally {
    warn.mockRestore();
  }
}

/** Снятие оставляет одно событие с причиной, строку журнала и причину в статусе покупки. */
async function expectRetirement(
  s: Scenario,
  purchaseRef: string,
  reason: string,
  lines: readonly unknown[],
): Promise<void> {
  expect(s.initCalls()).toBe(0);
  expect(
    await world.db.prisma.billingPaymentEvent.findMany({
      where: { purchaseRef },
    }),
  ).toMatchObject([{ kind: "dispatch_retired", payload: { reason } }]);
  expect(lines).toContainEqual({
    time: expect.any(String) as unknown,
    level: "warn",
    event: "billing_dispatch_retired",
    module: "billing",
    operation: "dispatch",
    purchaseRef,
    reason,
  });
  expect(await s.payments.status(s.buyer, purchaseRef)).toMatchObject({
    ok: true,
    value: { purchaseRef, state: "failed", retirementReason: reason },
  });
}

const closures = [
  {
    closure: "an archived price",
    reason: "sale_closed",
    close: async (s: Scenario) => {
      value(
        await s.pricing.manage(world.owner, {
          operation: "productPrices.archive",
          operationId: randomUUID(),
          expectedRevision: 1,
          id: s.productId,
        }),
      );
    },
  },
  {
    closure: "an archived Product",
    reason: "sale_closed",
    close: async (s: Scenario) => {
      await world.db.prisma.product.update({
        where: { id: s.productId },
        data: { archivedAt: world.time() },
      });
    },
  },
  {
    closure: "a storefront price taken off sale",
    reason: "price_unavailable",
    close: async (s: Scenario) => {
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
    },
  },
];

test.each(closures)(
  "a purchase retired before Init because of $closure records the reason and shows it to the buyer",
  async ({ reason, close }) => {
    const s = await world.scenario();
    const purchaseRef = await interruptedPurchase(s);
    await close(s);
    const { result: resumed, lines } = await warnings(() =>
      s.payments.purchase(s.buyer, s.command),
    );
    expect(resumed).toMatchObject({
      ok: true,
      value: { purchaseRef, state: "failed", retirementReason: reason },
    });
    await expectRetirement(s, purchaseRef, reason, lines);
  },
);

test("a purchase retired before Init because the buyer already owns the Product records the reason and shows it to the buyer", async () => {
  const s = await world.scenario();
  const purchaseRef = await interruptedPurchase(s);
  expect(
    await s.grants.issueManualProductAccess(world.owner, {
      accountId: s.buyer,
      productId: s.productId,
      sourceRef: randomUUID(),
      reason: "Owner issued access before Init",
    }),
  ).toMatchObject({ ok: true });
  const { result: resumed, lines } = await warnings(() =>
    s.payments.purchase(s.buyer, s.command),
  );
  expect(resumed).toMatchObject({
    ok: false,
    error: { code: "existing_access" },
  });
  await expectRetirement(s, purchaseRef, "already_owned", lines);
});

test("an unsent one-time attempt saved under legacy terms is retired by reconciliation with a reason", async () => {
  const s = await world.scenario();
  const purchaseRef = randomUUID();
  const instant = world.time();
  await world.db.prisma.billingPurchase.create({
    data: {
      id: purchaseRef,
      accountId: s.buyer,
      quoteRef: s.quote.quoteRef,
      kind: "one_time",
      state: "prepared",
      lifecycleActive: false,
      environment: s.config.environment,
      terminalRef: s.config.terminalKey,
      amountKopecks: s.quote.snapshot.firstPriceKopecks,
      snapshot: s.quote.snapshot,
      acceptance: { historical: true },
      contact: {},
      fiscalization: "pending",
      createdAt: instant,
      updatedAt: instant,
    },
  });
  const { result: reconciled, lines } = await warnings(() =>
    s.payments.reconcile(purchaseRef),
  );
  expect(reconciled).toEqual({ ok: true, value: true });
  await expectRetirement(s, purchaseRef, "unsupported_attempt", lines);
});

test("a purchase the bank declined carries no retirement reason", async () => {
  const s = await world.scenario();
  const { purchaseRef } = value(await s.payments.purchase(s.buyer, s.command));
  await s.notify("REJECTED");
  expect(await s.payments.status(s.buyer, purchaseRef)).toMatchObject({
    ok: true,
    value: { state: "failed", retirementReason: null },
  });
  expect(
    await world.db.prisma.billingPaymentEvent.count({
      where: { purchaseRef, kind: "dispatch_retired" },
    }),
  ).toBe(0);
});
