import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";

import { listPayments } from "../../src/modules/billing/features/read-payments/read-payments.js";
import {
  createProductCommerceWorld,
  commerceValue as value,
} from "./setup/product-commerce.js";

/**
 * Задание сверки (#1929): выдача доступа идёт до запросов к банку, проход останавливается по
 * бюджету и продолжает с первой непроверенной строки, а форму после отказа сверка спрашивает всё
 * реже. Тесты одного файла делят базу и часы, поэтому порядок запросов к банку каждый читает
 * только по своим платежам.
 */
let world: Awaited<ReturnType<typeof createProductCommerceWorld>>;
beforeAll(async () => {
  world = await createProductCommerceWorld();
});
afterAll(async () => world.dispose());

const minute = 60_000;

function later(milliseconds: number) {
  world.setTime(new Date(world.time().getTime() + milliseconds));
}

/** Платежи, о которых сверка спросила банк через GetState, в порядке запросов. */
function stateRequests(s: Awaited<ReturnType<typeof world.scenario>>) {
  const requested: string[] = [];
  s.afterState((paymentId) => requested.push(paymentId));
  return requested;
}

test("recovery grants access for a confirmed payment before its first bank request", async () => {
  const paid = await world.scenario();
  const paidPurchase = value(
    await paid.payments.purchase(paid.buyer, paid.command),
  );
  expect(await paid.notify("CONFIRMED")).toMatchObject({ ok: true });
  const open = await world.scenario();
  value(await open.payments.purchase(open.buyer, open.command));
  const bank = open.holdState();
  const pass = open.payments.recover();
  try {
    await bank.arrived;
    // Банк ещё не ответил, а выдача по уже подтверждённой оплате уже записана.
    const fulfillment = await world.db.prisma.billingFulfillment.findMany({
      where: { purchaseRef: paidPurchase.purchaseRef },
      select: { appliedAt: true },
    });
    expect(fulfillment).toHaveLength(1);
    expect(fulfillment[0]?.appliedAt).not.toBeNull();
  } finally {
    bank.release();
    await pass;
  }
});

test("a recovery pass takes no new row after its budget ends, and the next pass starts from the first unchecked row", async () => {
  const scenarios = [];
  for (let index = 0; index < 3; index += 1) {
    later(1_000);
    const s = await world.scenario();
    value(await s.payments.purchase(s.buyer, s.command));
    scenarios.push({ s, paymentId: s.paymentId() });
  }
  const [first, second, third] = scenarios;
  if (first === undefined || second === undefined || third === undefined)
    throw new Error("three purchases are required");
  const ours = new Set(scenarios.map((item) => item.paymentId));
  later(minute);
  const budget = new AbortController();
  const requested: string[] = [];
  first.s.afterState((paymentId) => {
    requested.push(paymentId);
    // Бюджет кончается, пока банк отвечает о первой строке.
    if (paymentId === first.paymentId) budget.abort();
  });
  const stopped = value(await first.s.payments.recover(50, budget.signal));
  expect(requested.filter((id) => ours.has(id))).toEqual([first.paymentId]);
  // Две строки этого теста ждут; строки других тестов могут ждать вместе с ними.
  expect(stopped.deferred).toBeGreaterThanOrEqual(2);

  requested.length = 0;
  later(minute);
  value(await first.s.payments.recover(50, new AbortController().signal));
  expect(requested.filter((id) => ours.has(id))).toEqual([
    second.paymentId,
    third.paymentId,
    first.paymentId,
  ]);
});

test("a declined payment form is asked about at 1, 5, 15 and 60 minute steps, not on every pass", async () => {
  const start = world.time();
  const s = await world.scenario();
  value(await s.payments.purchase(s.buyer, s.command));
  const paymentId = s.paymentId();
  await s.notify("REJECTED");
  const requested = stateRequests(s);
  /** Сколько раз проход в момент `start + offset` спросил банк об этой форме. */
  const askedAt = async (offset: number) => {
    world.setTime(new Date(start.getTime() + offset));
    const before = requested.filter((id) => id === paymentId).length;
    value(await s.payments.recover());
    return requested.filter((id) => id === paymentId).length - before;
  };
  // Первые 10 минут после создания: раз в минуту.
  expect(await askedAt(minute)).toBe(1);
  expect(await askedAt(minute + 59_000)).toBe(0);
  expect(await askedAt(2 * minute)).toBe(1);
  // До часа: раз в 5 минут.
  expect(await askedAt(30 * minute)).toBe(1);
  expect(await askedAt(34 * minute)).toBe(0);
  expect(await askedAt(35 * minute)).toBe(1);
  // До 4 часов: раз в 15 минут.
  expect(await askedAt(120 * minute)).toBe(1);
  expect(await askedAt(134 * minute)).toBe(0);
  expect(await askedAt(135 * minute)).toBe(1);
  // Дальше до конца суток: раз в час.
  expect(await askedAt(300 * minute)).toBe(1);
  expect(await askedAt(359 * minute)).toBe(0);
  expect(await askedAt(360 * minute)).toBe(1);
  // Форма живёт сутки: после них сверка о ней не спрашивает.
  expect(await askedAt(24 * 60 * minute + minute)).toBe(0);
});

/**
 * Покупка на проверке закрыта с признаком `refundReviewRequired`, новая покупка того же продукта
 * создаётся рядом с ней, а не продолжает её, и список проверки владельца показывает прежнюю.
 */
async function expectReleasedForOwnerReview(
  s: Awaited<ReturnType<typeof world.scenario>>,
  heldRef: string,
) {
  expect(
    await world.db.prisma.billingPurchase.findUniqueOrThrow({
      where: { id: heldRef },
      select: { state: true, refundReviewRequired: true },
    }),
  ).toEqual({ state: "failed", refundReviewRequired: true });
  const repeat = value(
    await s.payments.purchase(s.buyer, await s.repeatCommand()),
  );
  expect(repeat.purchaseRef).not.toBe(heldRef);
  expect(repeat.state).toBe("pending");
  const review = await listPayments(world.db.prisma, {
    operation: "payments.list",
    operationId: randomUUID(),
    accountId: s.buyer,
    events: "review",
    limit: 100,
  });
  expect(review).toMatchObject({
    ok: true,
    result: { items: [{ purchaseRef: heldRef }] },
  });
}

test("an unconfirmed purchase with a partial refund stops holding the Product at once and is listed for the owner", async () => {
  const s = await world.scenario();
  const held = value(await s.payments.purchase(s.buyer, s.command));
  expect(await s.notify("PARTIAL_REFUNDED", { Amount: 1000 })).toMatchObject({
    ok: true,
  });
  // Сверка ещё не шла: уведомление само снимает покупку с ожидания.
  await expectReleasedForOwnerReview(s, held.purchaseRef);
});

test("recovery releases an unknown purchase under partial refund review left before #1929", async () => {
  const s = await world.scenario();
  const held = value(await s.payments.purchase(s.buyer, s.command));
  // Так частичный возврат оставлял покупку до #1929: unknown с открытым резервом.
  await world.db.prisma.billingPurchase.update({
    where: { id: held.purchaseRef },
    data: { state: "unknown", refundReviewRequired: true, paymentUrl: null },
  });
  value(await s.payments.recover());
  await expectReleasedForOwnerReview(s, held.purchaseRef);
});
