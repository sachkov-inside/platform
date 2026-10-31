import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";

import { tbankToken } from "../../src/modules/billing/infrastructure/tbank/tbank.js";
import {
  createProductCommerceWorld,
  commerceValue as value,
} from "./setup/product-commerce.js";

/**
 * Полный перечень статусов T-Bank, вторая оплата при доступе из любого источника и выдача
 * удалённому аккаунту (#1930). Перечень статусов:
 * https://developer.tbank.ru/eacq/intro/developer/operation-statuses
 */
let world: Awaited<ReturnType<typeof createProductCommerceWorld>>;
beforeAll(async () => {
  world = await createProductCommerceWorld();
});
afterAll(async () => world.dispose());

type Scenario = Awaited<ReturnType<typeof world.scenario>>;

async function purchaseRow(purchaseRef: string) {
  return world.db.prisma.billingPurchase.findUniqueOrThrow({
    where: { id: purchaseRef },
    select: { state: true, paymentUrl: true, refundReviewRequired: true },
  });
}

async function eventPayload(purchaseRef: string, kind: string) {
  const row = await world.db.prisma.billingPaymentEvent.findUnique({
    where: { purchaseRef_kind: { purchaseRef, kind } },
    select: { payload: true },
  });
  return row?.payload ?? null;
}

/** Покупка с открытой формой оплаты: Init дошёл до банка, форма ещё не оплачена. */
async function openForm(s?: Scenario) {
  const scenario = s ?? (await world.scenario());
  const purchase = value(
    await scenario.payments.purchase(scenario.buyer, scenario.command),
  );
  return { s: scenario, purchaseRef: purchase.purchaseRef };
}

/**
 * Строки аккаунта больше нет. Удаления аккаунта в коде нет: согласия неизменяемы и держат внешний
 * ключ, поэтому тест снимает проверки ключей и триггеры только на свою транзакцию. Покупки Billing
 * внешнего ключа на аккаунт не имеют и остаются.
 */
async function deleteAccount(accountId: string) {
  await world.db.prisma.$transaction(async (tx) => {
    await tx.$executeRaw`set local session_replication_role = replica`;
    await tx.account.delete({ where: { id: accountId } });
  });
}

/** Подписанное уведомление с произвольными полями: подпись считается от итогового тела. */
function signed(s: Scenario, fields: Record<string, unknown>) {
  const body = { ...s.event(), ...fields };
  return { ...body, Token: tbankToken(body, s.config.password) };
}

test.each(["3DS_CHECKING", "3DS_CHECKED"])(
  "a form in 3-D Secure (%s) is acknowledged and keeps the purchase waiting for the bank",
  async (status) => {
    const { s, purchaseRef } = await openForm();
    expect(await s.notify(status)).toEqual({ ok: true, value: true });
    expect(await purchaseRow(purchaseRef)).toEqual({
      state: "pending",
      paymentUrl: null,
      refundReviewRequired: false,
    });
  },
);

test.each(["PAY_CHECKING", "CONFIRM_CHECKING", "ASYNC_REFUNDING"])(
  "an undecided bank operation (%s) is acknowledged and sends the purchase to reconciliation",
  async (status) => {
    const { s, purchaseRef } = await openForm();
    expect(await s.notify(status)).toEqual({ ok: true, value: true });
    expect(await purchaseRow(purchaseRef)).toMatchObject({
      state: "unknown",
      paymentUrl: null,
    });
    expect(await eventPayload(purchaseRef, "bank_status_unrecognized")).toBe(
      null,
    );
  },
);

test("a form closed after too many openings (ATTEMPTS_EXPIRED) fails the attempt", async () => {
  const { s, purchaseRef } = await openForm();
  expect(await s.notify("ATTEMPTS_EXPIRED")).toEqual({ ok: true, value: true });
  expect(await purchaseRow(purchaseRef)).toEqual({
    state: "failed",
    paymentUrl: null,
    refundReviewRequired: false,
  });
});

test("a partial reversal of a hold is kept once for review without trusting its Amount", async () => {
  const { s, purchaseRef } = await openForm();
  expect(await s.notify("AUTHORIZED")).toEqual({ ok: true, value: true });
  expect(await s.notify("PARTIAL_REVERSED", { Amount: 50_000 })).toEqual({
    ok: true,
    value: true,
  });
  // Неподтверждённая покупка с частичным возвратом снимается с ожидания и ждёт владельца (#1929).
  expect(await purchaseRow(purchaseRef)).toEqual({
    state: "failed",
    paymentUrl: null,
    refundReviewRequired: true,
  });
  const observations = await world.db.prisma.billingPaymentEvent.findMany({
    where: {
      purchaseRef,
      kind: { startsWith: "partial_refund_observed:" },
    },
    select: { payload: true },
  });
  expect(observations).toEqual([
    {
      payload: {
        status: "PARTIAL_REVERSED",
        paymentId: s.paymentId(),
        orderId: purchaseRef,
        observedAmountKopecks: 50_000,
        resolution: "amount_unresolved",
      },
    },
  ]);
});

test("an authentic status missing from the documented list is acknowledged, sent to reconciliation and recorded for the owner", async () => {
  const { s, purchaseRef } = await openForm();
  expect(await s.notify("QR_SETTLING")).toEqual({ ok: true, value: true });
  expect(await purchaseRow(purchaseRef)).toMatchObject({
    state: "unknown",
    paymentUrl: null,
  });
  expect(await eventPayload(purchaseRef, "bank_status_unrecognized")).toEqual({
    paymentId: s.paymentId(),
    status: "QR_SETTLING",
  });
  // GetState отвечает тем же статусом: сверка не считает банк недоступным и не повторяет Init.
  s.setStatus("QR_SETTLING");
  expect(await s.payments.reconcile(purchaseRef)).toEqual({
    ok: true,
    value: true,
  });
  expect((await purchaseRow(purchaseRef)).state).toBe("unknown");
  expect(s.initCalls()).toBe(1);
  // Банк определился: та же покупка подтверждается обычным путём.
  expect(await s.notify("CONFIRMED")).toEqual({ ok: true, value: true });
  expect((await purchaseRow(purchaseRef)).state).toBe("confirmed");
});

test("an unrecognized status never reopens a confirmed purchase", async () => {
  const { s, purchaseRef } = await openForm();
  expect(await s.notify("CONFIRMED")).toEqual({ ok: true, value: true });
  expect(await s.notify("QR_SETTLING")).toEqual({ ok: true, value: true });
  expect((await purchaseRow(purchaseRef)).state).toBe("confirmed");
});

test.each([
  [
    "a wrong signature",
    (s: Scenario) => ({
      ...signed(s, { Status: "QR_SETTLING" }),
      Token: "0".repeat(64),
    }),
  ],
  [
    "another terminal",
    (s: Scenario) =>
      signed(s, { Status: "QR_SETTLING", TerminalKey: "OTHERTERMINAL" }),
  ],
  [
    "another amount",
    (s: Scenario) => signed(s, { Status: "QR_SETTLING", Amount: 1 }),
  ],
  [
    "a status outside the bank's alphabet",
    (s: Scenario) => signed(s, { Status: "qr settling" }),
  ],
  [
    "an overlong status",
    (s: Scenario) => signed(s, { Status: "A".repeat(65) }),
  ],
] as const)(
  "an unrecognized status with %s is still rejected and changes nothing",
  async (_case, notification) => {
    const { s, purchaseRef } = await openForm();
    expect(await s.payments.notification(notification(s))).toEqual({
      ok: false,
      error: { code: "invalid_notification" },
    });
    expect((await purchaseRow(purchaseRef)).state).toBe("pending");
    expect(await eventPayload(purchaseRef, "bank_status_unrecognized")).toBe(
      null,
    );
  },
);

test.each(["manual", "course_activation"] as const)(
  "a confirmed payment for a product the Account received by %s while the form was open is marked as a second payment",
  async (source) => {
    const { s, purchaseRef } = await openForm();
    const issued = await s.grants.issueProductAccess(
      source === "manual" ? { source, actorId: world.owner } : { source },
      {
        accountId: s.buyer,
        productId: s.productId,
        sourceRef: `${source}:${randomUUID()}`,
        issuedAt: world.time().toISOString(),
        reason: "granted_while_form_open",
      },
    );
    expect(issued).toMatchObject({ ok: true, outcome: "issued" });
    expect(await s.notify("CONFIRMED")).toEqual({ ok: true, value: true });
    expect((await purchaseRow(purchaseRef)).state).toBe("confirmed");
    expect(await eventPayload(purchaseRef, "duplicate_payment_review")).toEqual(
      { paidPurchaseRefs: [], heldProductIds: [s.productId] },
    );
  },
);

test("a confirmed payment for a product whose access the owner revoked is marked for the owner's decision", async () => {
  const { s, purchaseRef } = await openForm();
  value(
    await s.grants.issueManualProductAccess(world.owner, {
      accountId: s.buyer,
      productId: s.productId,
      sourceRef: `manual:${randomUUID()}`,
      reason: "granted_while_form_open",
    }),
  );
  value(
    await s.grants.revokeProductAccess(world.owner, {
      accountId: s.buyer,
      productId: s.productId,
      operationId: randomUUID(),
      expectedRevision: 1,
      reason: "revoked_while_form_open",
    }),
  );
  expect(await s.notify("CONFIRMED")).toEqual({ ok: true, value: true });
  expect(await eventPayload(purchaseRef, "duplicate_payment_review")).toEqual({
    paidPurchaseRefs: [],
    heldProductIds: [s.productId],
  });
});

test("a first payment without any earlier access records no second payment", async () => {
  const { s, purchaseRef } = await openForm();
  expect(await s.notify("CONFIRMED")).toEqual({ ok: true, value: true });
  expect(await eventPayload(purchaseRef, "duplicate_payment_review")).toBe(
    null,
  );
});

test("fulfillment for a deleted Account moves to owner review once instead of retrying forever", async () => {
  const { s, purchaseRef } = await openForm();
  expect(await s.notify("CONFIRMED")).toEqual({ ok: true, value: true });
  await deleteAccount(s.buyer);
  value(await s.payments.recover());
  const outbox = await world.db.prisma.billingFulfillment.findFirstOrThrow({
    where: { purchaseRef },
  });
  expect(outbox).toMatchObject({
    appliedAt: null,
    reviewRequiredAt: world.time(),
    reviewReason: "account_deleted",
  });
  expect(
    await eventPayload(purchaseRef, "fulfillment_review_required"),
  ).toEqual(expect.objectContaining({ reason: "account_deleted" }));
  world.setTime(new Date(world.time().getTime() + 5 * 60_000));
  value(await s.payments.recover());
  expect(
    await world.db.prisma.billingFulfillment.findFirstOrThrow({
      where: { purchaseRef },
    }),
  ).toEqual(outbox);
  expect(
    await world.db.prisma.billingPaymentEvent.count({
      where: { purchaseRef, kind: "fulfillment_review_required" },
    }),
  ).toBe(1);
});
