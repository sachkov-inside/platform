import { afterAll, beforeAll, expect, test } from "vitest";

import { declinedPaymentRecheckMilliseconds } from "../../src/modules/billing/facets/billing-payments/billing-payments.js";
import {
  createProductCommerceWorld,
  commerceValue as value,
} from "./setup/product-commerce.js";

/**
 * Отмена неоплаченной формы T-Bank у попытки, которую Inside снял (#1923). Банк получает Cancel
 * только после GetState со статусом `NEW` или `FORM_SHOWED`, на полную сумму и вне транзакции.
 */
let world: Awaited<ReturnType<typeof createProductCommerceWorld>>;
beforeAll(async () => {
  world = await createProductCommerceWorld();
});
afterAll(async () => world.dispose());

async function eventKinds(purchaseRef: string) {
  const rows = await world.db.prisma.billingPaymentEvent.findMany({
    where: { purchaseRef },
    select: { kind: true },
  });
  return rows.map((row) => row.kind).sort();
}

async function eventPayload(purchaseRef: string, kind: string) {
  const row = await world.db.prisma.billingPaymentEvent.findUnique({
    where: { purchaseRef_kind: { purchaseRef, kind } },
    select: { payload: true },
  });
  return row?.payload ?? null;
}

async function purchaseState(purchaseRef: string) {
  return world.db.prisma.billingPurchase.findUniqueOrThrow({
    where: { id: purchaseRef },
    select: { state: true, paymentId: true, paymentUrl: true },
  });
}

/**
 * Первая попытка отказана, повторная открыла новую форму, затем банк подтвердил первую.
 * Inside снимает повторную попытку, а её форма в банке ещё открыта.
 */
async function retiredRepeat() {
  const s = await world.scenario();
  const first = value(await s.payments.purchase(s.buyer, s.command));
  const firstPayment = { OrderId: first.purchaseRef, PaymentId: s.paymentId() };
  await s.notify("REJECTED");
  const repeat = value(
    await s.payments.purchase(s.buyer, await s.repeatCommand()),
  );
  const repeatPaymentId = s.paymentId();
  expect(await s.notify("CONFIRMED", firstPayment)).toMatchObject({
    ok: true,
  });
  expect(await purchaseState(repeat.purchaseRef)).toEqual({
    state: "failed",
    paymentId: repeatPaymentId,
    paymentUrl: null,
  });
  // Уведомление банка подтверждает оплату в транзакции; Cancel в нём не уходит.
  expect(s.cancelRequests()).toEqual([]);
  expect(
    await eventPayload(repeat.purchaseRef, "bank_cancel_requested"),
  ).toEqual({
    reason: "superseded_by_confirmed_payment",
    confirmedPurchaseRef: first.purchaseRef,
  });
  return { s, first, repeat, repeatPaymentId };
}

test.each(["NEW", "FORM_SHOWED"])(
  "recovery cancels the full bank form of a retired attempt that is still %s, once",
  async (formStatus) => {
    const { s, repeat, repeatPaymentId } = await retiredRepeat();
    s.setPaymentStatus(repeatPaymentId, formStatus);
    value(await s.payments.recover());
    // Без Amount: банк отменяет полную сумму платежа.
    const requests = s.cancelRequests();
    expect(requests).toHaveLength(1);
    expect(Object.keys(requests[0] ?? {}).sort()).toEqual([
      "PaymentId",
      "TerminalKey",
      "Token",
    ]);
    expect(requests[0]).toMatchObject({
      TerminalKey: s.config.terminalKey,
      PaymentId: repeatPaymentId,
    });
    expect(
      await eventPayload(repeat.purchaseRef, "bank_cancel_confirmed"),
    ).toEqual({
      paymentId: repeatPaymentId,
      status: "CANCELED",
    });
    value(await s.payments.recover());
    expect(s.cancelRequests()).toHaveLength(1);
    expect((await purchaseState(repeat.purchaseRef)).state).toBe("failed");
  },
);

test.each([
  ["PREAUTHORIZING", null],
  ["AUTHORIZING", null],
  ["AUTHORIZED", null],
  ["CONFIRMING", null],
  ["REJECTED", null],
  ["AUTH_FAIL", null],
  ["REVERSING", null],
  ["REFUNDING", null],
  ["PARTIAL_REFUNDED", null],
  ["REVERSED", "REVERSED"],
  ["CANCELED", "CANCELED"],
  ["DEADLINE_EXPIRED", "DEADLINE_EXPIRED"],
  ["CONFIRMED", "CONFIRMED"],
  ["REFUNDED", "REFUNDED"],
] as const)(
  "reconciliation never sends Cancel for a retired attempt in bank status %s",
  async (bankStatus, closedStatus) => {
    const { s, repeat, repeatPaymentId } = await retiredRepeat();
    s.setPaymentStatus(repeatPaymentId, bankStatus);
    value(await s.payments.reconcile(repeat.purchaseRef));
    value(await s.payments.reconcile(repeat.purchaseRef));
    expect(s.cancelRequests()).toEqual([]);
    expect(
      await eventPayload(repeat.purchaseRef, "bank_cancel_confirmed"),
    ).toEqual(
      closedStatus === null
        ? null
        : { paymentId: repeatPaymentId, status: closedStatus },
    );
  },
);

test("a retired attempt that the bank confirmed before the cancel is confirmed and marked as a second payment", async () => {
  const { s, first, repeat, repeatPaymentId } = await retiredRepeat();
  s.setPaymentStatus(repeatPaymentId, "CONFIRMED");
  value(await s.payments.reconcile(repeat.purchaseRef));
  expect(s.cancelRequests()).toEqual([]);
  expect((await purchaseState(repeat.purchaseRef)).state).toBe("confirmed");
  expect(
    await eventPayload(repeat.purchaseRef, "duplicate_payment_review"),
  ).toEqual({ paidPurchaseRefs: [first.purchaseRef], heldProductIds: [] });
});

test("a buyer who pays between the reconciliation read and the cancel is confirmed, and no Cancel is sent", async () => {
  const { s, first, repeat, repeatPaymentId } = await retiredRepeat();
  let reads = 0;
  // Сверка прочитала NEW; к проверке перед Cancel покупатель уже оплатил форму.
  s.afterState((paymentId) => {
    if (paymentId !== repeatPaymentId) return;
    reads += 1;
    if (reads === 1) s.setPaymentStatus(repeatPaymentId, "CONFIRMED");
  });
  try {
    value(await s.payments.reconcile(repeat.purchaseRef));
  } finally {
    s.afterState(undefined);
  }
  expect(reads).toBe(2);
  expect(s.cancelRequests()).toEqual([]);
  expect((await purchaseState(repeat.purchaseRef)).state).toBe("confirmed");
  expect(
    await eventPayload(repeat.purchaseRef, "duplicate_payment_review"),
  ).toEqual({ paidPurchaseRefs: [first.purchaseRef], heldProductIds: [] });
});

test("a buyer who pays between the cancel check and the Cancel gets the money back, and the owner sees it", async () => {
  const { s, repeat, repeatPaymentId } = await retiredRepeat();
  let reads = 0;
  // Проверка перед Cancel ещё видела NEW; Cancel пришёл уже к оплаченному платежу.
  s.afterState((paymentId) => {
    if (paymentId !== repeatPaymentId) return;
    reads += 1;
    if (reads === 2) s.setPaymentStatus(repeatPaymentId, "CONFIRMED");
  });
  try {
    value(await s.payments.reconcile(repeat.purchaseRef));
  } finally {
    s.afterState(undefined);
  }
  expect(s.cancelRequests()).toHaveLength(1);
  expect(
    await eventPayload(repeat.purchaseRef, "bank_cancel_returned_payment"),
  ).toEqual({ paymentId: repeatPaymentId, status: "REFUNDED" });
  expect(
    await eventPayload(repeat.purchaseRef, "bank_cancel_confirmed"),
  ).toBeNull();
  // Следующая сверка принимает возврат обычным путём и больше не шлёт Cancel.
  value(await s.payments.reconcile(repeat.purchaseRef));
  expect(s.cancelRequests()).toHaveLength(1);
  expect((await purchaseState(repeat.purchaseRef)).state).toBe("confirmed");
  // Деньги уже вернул Cancel: решения о возврате владелец не ждёт.
  expect(
    await eventPayload(repeat.purchaseRef, "duplicate_payment_review"),
  ).toBeNull();
  expect(
    await eventPayload(repeat.purchaseRef, "bank_cancel_confirmed"),
  ).toEqual({ paymentId: repeatPaymentId, status: "REFUNDED" });
});

test("recovery cancels a form retired late in the attempt's first day until a day after the retirement", async () => {
  const start = world.time();
  try {
    const s = await world.scenario();
    const first = value(await s.payments.purchase(s.buyer, s.command));
    const firstPayment = {
      OrderId: first.purchaseRef,
      PaymentId: s.paymentId(),
    };
    await s.notify("REJECTED");
    const repeat = value(
      await s.payments.purchase(s.buyer, await s.repeatCommand()),
    );
    const repeatPaymentId = s.paymentId();
    world.setTime(new Date(start.getTime() + 20 * 60 * 60 * 1000));
    expect(await s.notify("CONFIRMED", firstPayment)).toMatchObject({
      ok: true,
    });
    // Прошло больше суток от создания попытки, но меньше суток от её снятия.
    world.setTime(
      new Date(start.getTime() + declinedPaymentRecheckMilliseconds + 60_000),
    );
    value(await s.payments.recover());
    expect(s.cancelRequests()).toMatchObject([{ PaymentId: repeatPaymentId }]);
    expect(
      await eventPayload(repeat.purchaseRef, "bank_cancel_confirmed"),
    ).toEqual({ paymentId: repeatPaymentId, status: "CANCELED" });
  } finally {
    world.setTime(start);
  }
});

test("a buyer repeating the retired purchase command sees the failed attempt without waiting for the Cancel", async () => {
  const s = await world.scenario();
  const first = value(await s.payments.purchase(s.buyer, s.command));
  const firstPayment = { OrderId: first.purchaseRef, PaymentId: s.paymentId() };
  await s.notify("REJECTED");
  const repeatCommand = await s.repeatCommand();
  const repeat = value(await s.payments.purchase(s.buyer, repeatCommand));
  expect(await s.notify("CONFIRMED", firstPayment)).toMatchObject({
    ok: true,
  });
  expect(await s.payments.purchase(s.buyer, repeatCommand)).toMatchObject({
    ok: true,
    value: { purchaseRef: repeat.purchaseRef, state: "failed" },
  });
  expect(s.cancelRequests()).toEqual([]);
  value(await s.payments.reconcile(repeat.purchaseRef));
  expect(s.cancelRequests()).toHaveLength(1);
});

test("an unavailable Cancel is sent again by the next recovery and closes with CANCELED", async () => {
  const { s, repeat, repeatPaymentId } = await retiredRepeat();
  s.failCancel();
  expect(await s.payments.reconcile(repeat.purchaseRef)).toMatchObject({
    ok: false,
    error: { code: "provider_unavailable" },
  });
  expect(
    await eventPayload(repeat.purchaseRef, "bank_cancel_confirmed"),
  ).toBeNull();
  value(await s.payments.recover());
  expect(s.cancelRequests()).toHaveLength(2);
  expect(
    await eventPayload(repeat.purchaseRef, "bank_cancel_confirmed"),
  ).toEqual({
    paymentId: repeatPaymentId,
    status: "CANCELED",
  });
});

test("a Cancel that keeps failing is retried on the decaying schedule counted from the retirement (#1929)", async () => {
  const start = world.time();
  try {
    const s = await world.scenario();
    const first = value(await s.payments.purchase(s.buyer, s.command));
    const firstPayment = {
      OrderId: first.purchaseRef,
      PaymentId: s.paymentId(),
    };
    await s.notify("REJECTED");
    value(await s.payments.purchase(s.buyer, await s.repeatCommand()));
    const retiredAt = start.getTime() + 20 * 60 * 60 * 1000;
    world.setTime(new Date(retiredAt));
    expect(await s.notify("CONFIRMED", firstPayment)).toMatchObject({
      ok: true,
    });
    s.failCancel(10);
    world.setTime(new Date(retiredAt + 60_000));
    value(await s.payments.recover());
    expect(s.cancelRequests()).toHaveLength(1);
    // Следующий проход той же минуты банк не спрашивает.
    value(await s.payments.recover());
    expect(s.cancelRequests()).toHaveLength(1);
    // Снятие было минуту назад, а не 20 часов: шаг опроса ещё минутный.
    world.setTime(new Date(retiredAt + 2 * 60_000));
    value(await s.payments.recover());
    expect(s.cancelRequests()).toHaveLength(2);
  } finally {
    world.setTime(start);
  }
});

test("a bank-declined attempt reopened on its payment form is never cancelled", async () => {
  const s = await world.scenario();
  const purchase = value(await s.payments.purchase(s.buyer, s.command));
  await s.notify("REJECTED");
  // После отказа покупатель вернулся на ту же форму, чтобы выбрать другой способ (#1919).
  s.setPaymentStatus(s.paymentId(), "FORM_SHOWED");
  value(await s.payments.reconcile(purchase.purchaseRef));
  expect(s.cancelRequests()).toEqual([]);
  expect(await eventKinds(purchase.purchaseRef)).not.toContain(
    "bank_cancel_requested",
  );
});

test("an attempt retired while its Init was in flight keeps the late PaymentId and is cancelled", async () => {
  const s = await world.scenario();
  const first = value(await s.payments.purchase(s.buyer, s.command));
  const firstPayment = { OrderId: first.purchaseRef, PaymentId: s.paymentId() };
  await s.notify("REJECTED");
  const init = s.holdInit();
  const repeatStarted = s.payments.purchase(s.buyer, await s.repeatCommand());
  // Банк уже создал платёж повторной попытки, но его ответ ещё не дошёл до Inside.
  await init.arrived;
  const repeatPaymentId = s.paymentId();
  const { id: repeatRef } =
    await world.db.prisma.billingPurchase.findFirstOrThrow({
      where: { accountId: s.buyer, state: "sent" },
      select: { id: true },
    });
  expect(await s.notify("CONFIRMED", firstPayment)).toMatchObject({
    ok: true,
  });
  expect((await purchaseState(repeatRef)).state).toBe("failed");
  init.release();
  await repeatStarted;
  expect(await purchaseState(repeatRef)).toEqual({
    state: "failed",
    paymentId: repeatPaymentId,
    paymentUrl: null,
  });
  value(await s.payments.recover());
  expect(s.cancelRequests()).toMatchObject([{ PaymentId: repeatPaymentId }]);
  expect(await eventPayload(repeatRef, "bank_cancel_confirmed")).toEqual({
    paymentId: repeatPaymentId,
    status: "CANCELED",
  });
});

/** Повторная попытка зависла без ответа на Init, затем банк подтвердил первую. */
async function unknownRepeat() {
  const s = await world.scenario();
  const first = value(await s.payments.purchase(s.buyer, s.command));
  const firstPayment = { OrderId: first.purchaseRef, PaymentId: s.paymentId() };
  await s.notify("REJECTED");
  s.loseInit();
  await s.payments.purchase(s.buyer, await s.repeatCommand());
  const repeat = await world.db.prisma.billingPurchase.findFirstOrThrow({
    where: { accountId: s.buyer, id: { not: first.purchaseRef } },
  });
  const repeatPaymentId = s.paymentId();
  expect(repeat.state).toBe("unknown");
  expect(await s.notify("CONFIRMED", firstPayment)).toMatchObject({
    ok: true,
  });
  // Исход неизвестен: Inside не снимает попытку, пока не спросит банк.
  expect((await purchaseState(repeat.id)).state).toBe("unknown");
  expect(await eventPayload(repeat.id, "bank_cancel_requested")).toEqual({
    reason: "superseded_by_confirmed_payment",
    confirmedPurchaseRef: first.purchaseRef,
  });
  return { s, first, repeat, repeatPaymentId };
}

test("an unknown repeat attempt is checked with the bank first and its unpaid form is retired and cancelled", async () => {
  const { s, first, repeat, repeatPaymentId } = await unknownRepeat();
  value(await s.payments.recover());
  expect(await purchaseState(repeat.id)).toEqual({
    state: "failed",
    paymentId: repeatPaymentId,
    paymentUrl: null,
  });
  expect(
    await eventPayload(repeat.id, "superseded_by_confirmed_payment"),
  ).toEqual({ confirmedPurchaseRef: first.purchaseRef });
  expect(s.cancelRequests()).toMatchObject([{ PaymentId: repeatPaymentId }]);
  expect(await eventPayload(repeat.id, "bank_cancel_confirmed")).toEqual({
    paymentId: repeatPaymentId,
    status: "CANCELED",
  });
});

test("an unknown repeat attempt that the bank reports paid is confirmed as a second payment without a Cancel", async () => {
  const { s, first, repeat, repeatPaymentId } = await unknownRepeat();
  s.setPaymentStatus(repeatPaymentId, "CONFIRMED");
  value(await s.payments.recover());
  expect(s.cancelRequests()).toEqual([]);
  expect((await purchaseState(repeat.id)).state).toBe("confirmed");
  // Сверка выдаёт доступ по первой оплате до запросов к банку (#1929), поэтому вторая оплата
  // видит продукт уже выданным.
  expect(await eventPayload(repeat.id, "duplicate_payment_review")).toEqual({
    paidPurchaseRefs: [first.purchaseRef],
    heldProductIds: [s.productId],
  });
  expect(await eventPayload(repeat.id, "bank_cancel_confirmed")).toEqual({
    paymentId: repeatPaymentId,
    status: "CONFIRMED",
  });
});
