import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { BillingOperations } from "../../src/modules/billing/index.js";
import type { OwnerResult } from "../../src/modules/billing/domain/owner-operations.js";
import {
  Tbank,
  tbankToken,
} from "../../src/modules/billing/infrastructure/tbank/tbank.js";
import {
  createProductCommerceWorld,
  commerceValue as value,
} from "./setup/product-commerce.js";
let world: Awaited<ReturnType<typeof createProductCommerceWorld>>;
beforeAll(async () => {
  world = await createProductCommerceWorld();
});
afterAll(async () => world.dispose());

test("signature and exact Order/Payment/terminal/amount binding precede notification replay", async () => {
  const s = await world.scenario();
  const purchase = value(await s.payments.purchase(s.buyer, s.command));
  for (const extra of [
    { Amount: 1 },
    { TerminalKey: "OTHER" },
    { PaymentId: "OTHER" },
    { OrderId: randomUUID() },
    { Success: false },
  ])
    expect(await s.notify("CONFIRMED", extra)).toMatchObject({
      ok: false,
      error: { code: "invalid_notification" },
    });
  const body = s.event("CONFIRMED");
  expect(
    await s.payments.notification({ ...body, Token: "0".repeat(64) }),
  ).toMatchObject({ ok: false });
  expect(
    value(await s.payments.status(s.buyer, purchase.purchaseRef)).access,
  ).toBe("awaiting_payment");
  expect(await s.notify("CONFIRMED")).toMatchObject({ ok: true });
  expect(await s.notify("CONFIRMED", { Amount: 1 })).toMatchObject({
    ok: false,
  });
});

test("receipt and AUTHORIZED never fulfill; confirmed replay issues the same lifetime Product right", async () => {
  const s = await world.scenario();
  const purchase = value(await s.payments.purchase(s.buyer, s.command));
  for (const status of ["RECEIPT", "AUTHORIZED"]) {
    expect(await s.notify(status)).toMatchObject({ ok: true });
    await s.payments.recover();
    expect(
      value(await s.payments.status(s.buyer, purchase.purchaseRef)).access,
    ).toBe("awaiting_payment");
  }
  await Promise.all([s.notify("CONFIRMED"), s.notify("CONFIRMED")]);
  await s.payments.recover();
  await s.payments.recover();
  expect(
    await s.grants.readProductAccess(world.owner, {
      accountId: s.buyer,
      productId: s.productId,
    }),
  ).toMatchObject({ ok: true, value: { access: "active", revision: 1 } });
  expect(s.initCalls()).toBe(1);
});

test("foreign Account cannot read or restore another buyer's payment, even knowing its exact reference", async () => {
  const s = await world.scenario(),
    other = await world.scenario();
  const purchase = value(await s.payments.purchase(s.buyer, s.command));
  expect(
    await s.payments.status(other.buyer, purchase.purchaseRef),
  ).toMatchObject({ ok: false, error: { code: "not_found" } });
  expect(
    await s.payments.restoreProductPurchase(
      other.buyer,
      s.productId,
      purchase.purchaseRef,
    ),
  ).toMatchObject({ ok: false, error: { code: "not_found" } });
  expect(
    await s.payments.purchaseEmail(other.buyer, purchase.purchaseRef),
  ).toEqual({ ok: true, value: null });
});

test("one operation cannot replay a changed purchase payload", async () => {
  const s = await world.scenario();
  const first = value(await s.payments.purchase(s.buyer, s.command));
  expect(
    await s.payments.purchase(s.buyer, {
      ...s.command,
      email: "changed@example.test",
    }),
  ).toMatchObject({ ok: false, error: { code: "operation_conflict" } });
  expect(value(await s.payments.purchase(s.buyer, s.command)).purchaseRef).toBe(
    first.purchaseRef,
  );
  expect(s.initCalls()).toBe(1);
});

test("accepted payment and event snapshots reject destructive history rewrites", async () => {
  const s = await world.scenario();
  const purchase = value(await s.payments.purchase(s.buyer, s.command));
  await s.notify("CONFIRMED");
  await expect(
    world.db.prisma.billingPurchase.update({
      where: { id: purchase.purchaseRef },
      data: { snapshot: {} },
    }),
  ).rejects.toThrow();
  await expect(
    world.db.prisma.billingPaymentEvent.deleteMany({
      where: { purchaseRef: purchase.purchaseRef },
    }),
  ).rejects.toThrow();
  expect(
    value(await s.payments.status(s.buyer, purchase.purchaseRef)).snapshot,
  ).toEqual(s.quote.snapshot);
});

test("bank adapter binds only scalar signed facts and rejects a payment URL outside bank origins", async () => {
  const s = await world.scenario();
  const body = s.event("CONFIRMED");
  expect(
    tbankToken(
      { ...body, Receipt: { Email: "secret@example.test" } },
      s.config.password,
    ),
  ).toBe(tbankToken(body, s.config.password));
  const bank = new Tbank(s.config, () =>
    Promise.resolve(
      Response.json({ ...body, PaymentURL: "https://attacker.invalid/pay" }),
    ),
  );
  await expect(
    bank.init({
      orderId: randomUUID(),
      accountId: s.buyer,
      amount: 200000,
      name: "Product",
      email: "order@example.test",
    }),
  ).rejects.toThrow();
});

const defaultNow = new Date("2030-01-31T10:00:00Z");

function ownerOperations(s: Awaited<ReturnType<typeof world.scenario>>) {
  return new BillingOperations({
    prisma: world.db.prisma,
    accounts: s.accounts,
    pricing: s.pricing,
    payments: s.payments,
    grants: s.grants,
    bank: s.bank,
  });
}

/** One purchase of `productId` started at `at` by a fresh buyer. */
async function purchaseAt(at: string, productId?: string) {
  world.setTime(new Date(at));
  const s = await world.scenario(productId === undefined ? {} : { productId });
  const purchase = value(await s.payments.purchase(s.buyer, s.command));
  return { s, purchaseRef: purchase.purchaseRef };
}

async function listPayments(
  owner: BillingOperations,
  filter: Record<string, unknown>,
) {
  return await owner.execute(world.owner, {
    operation: "payments.list",
    operationId: randomUUID(),
    ...filter,
  });
}

function paymentsPage(result: OwnerResult) {
  if (!result.ok || result.result.outcome !== "payments")
    throw new Error(JSON.stringify(result));
  return result.result;
}

function refs(result: OwnerResult): string[] {
  return paymentsPage(result).items.map((item) => item.purchaseRef);
}

test("payments.list narrows by Product, period [from, to) and several states, newest first", async () => {
  try {
    const first = await purchaseAt("2030-02-01T10:00:00Z");
    const productId = first.s.productId;
    const second = await purchaseAt("2030-02-02T10:00:00Z", productId);
    const third = await purchaseAt("2030-02-03T10:00:00Z", productId);
    const other = await purchaseAt("2030-02-02T12:00:00Z");
    await second.s.notify("CONFIRMED");
    const owner = ownerOperations(first.s);

    expect(refs(await listPayments(owner, { productId }))).toEqual([
      third.purchaseRef,
      second.purchaseRef,
      first.purchaseRef,
    ]);
    expect(
      refs(
        await listPayments(owner, {
          productId,
          from: "2030-02-02T13:00:00+03:00",
          to: "2030-02-03T10:00:00Z",
        }),
      ),
    ).toEqual([second.purchaseRef]);
    expect(
      refs(
        await listPayments(owner, {
          from: "2030-02-02T00:00:00Z",
          to: "2030-02-03T00:00:00Z",
        }),
      ),
    ).toEqual([other.purchaseRef, second.purchaseRef]);
    expect(
      refs(await listPayments(owner, { productId, states: ["confirmed"] })),
    ).toEqual([second.purchaseRef]);
    expect(
      refs(
        await listPayments(owner, {
          productId,
          states: ["confirmed", "failed"],
        }),
      ),
    ).toEqual([second.purchaseRef]);
    expect(
      refs(await listPayments(owner, { productId, state: "confirmed" })),
    ).toEqual([second.purchaseRef]);
    expect(
      refs(await listPayments(owner, { productId: randomUUID() })),
    ).toEqual([]);
  } finally {
    world.setTime(defaultNow);
  }
});

test("payments.list continues by cursor within its filter and refuses a cursor or filter outside it", async () => {
  try {
    const first = await purchaseAt("2030-03-01T10:00:00Z");
    const productId = first.s.productId;
    const second = await purchaseAt("2030-03-01T10:00:00Z", productId);
    const third = await purchaseAt("2030-03-02T10:00:00Z", productId);
    const other = await purchaseAt("2030-03-02T10:00:00Z");
    const owner = ownerOperations(first.s);

    const seen: string[] = [];
    let cursor: string | null | undefined;
    do {
      const page = await listPayments(owner, {
        productId,
        limit: 1,
        ...(cursor === undefined ? {} : { cursor }),
      });
      seen.push(...refs(page));
      cursor = paymentsPage(page).nextCursor;
    } while (cursor !== null);
    // Two payments of one instant keep a stable order by their reference.
    expect(seen).toEqual([
      third.purchaseRef,
      ...[first.purchaseRef, second.purchaseRef].sort().reverse(),
    ]);

    for (const filter of [
      { productId, cursor: other.purchaseRef },
      { productId, cursor: randomUUID() },
      {
        productId,
        from: "2030-03-02T00:00:00Z",
        cursor: first.purchaseRef,
      },
      { accountId: first.s.buyer, cursor: third.purchaseRef },
      { from: "2030-03-02T00:00:00Z", to: "2030-03-02T00:00:00Z" },
      { from: "2030-03-03T00:00:00Z", to: "2030-03-02T00:00:00Z" },
      { from: "2030-03-02" },
      { state: "pending", states: ["pending"] },
      { states: [] },
      { states: ["failed", "failed"] },
      {
        states: [
          "prepared",
          "sent",
          "unknown",
          "pending",
          "authorized",
          "confirmed",
          "failed",
          "failed",
        ],
      },
    ])
      expect(await listPayments(owner, filter)).toEqual({
        ok: false,
        error: { code: "invalid_request" },
      });
  } finally {
    world.setTime(defaultNow);
  }
});
