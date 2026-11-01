import { afterAll, beforeAll, expect, test } from "vitest";

import {
  createProductCommerceWorld,
  commerceValue as value,
} from "./setup/product-commerce.js";

/**
 * Срок формы оплаты (#1932): Init просит банк закрыть форму через 60 минут после отправки, а
 * сверка спрашивает банк о форме после отказа и о форме снятой попытки только в окне этого срока
 * с запасом, два часа. Тесты делят базу и часы, поэтому каждый ставит своё время и возвращает его.
 */
let world: Awaited<ReturnType<typeof createProductCommerceWorld>>;
beforeAll(async () => {
  world = await createProductCommerceWorld();
});
afterAll(async () => world.dispose());

const minute = 60_000;

test("Init asks the bank to close the payment form 60 minutes after it is sent", async () => {
  const start = world.time();
  try {
    world.setTime(new Date("2030-02-01T09:30:00Z"));
    const s = await world.scenario();
    value(await s.payments.purchase(s.buyer, s.command));
    // Формат документации T-Bank: YYYY-MM-DDTHH24:MI:SS+GMT, пример 2016-08-31T12:28:00+03:00.
    expect(s.initRequests()).toEqual([
      expect.objectContaining({ RedirectDueDate: "2030-02-01T13:30:00+03:00" }),
    ]);
  } finally {
    world.setTime(start);
  }
});

test("an expired payment form closes its attempt, and the buyer can start a new purchase", async () => {
  const s = await world.scenario();
  const expired = value(await s.payments.purchase(s.buyer, s.command));
  expect(expired.state).toBe("pending");
  expect(await s.notify("DEADLINE_EXPIRED")).toMatchObject({ ok: true });
  expect(
    value(await s.payments.status(s.buyer, expired.purchaseRef)),
  ).toMatchObject({ state: "failed", paymentUrl: null });
  const repeat = value(
    await s.payments.purchase(s.buyer, await s.repeatCommand()),
  );
  expect(repeat.purchaseRef).not.toBe(expired.purchaseRef);
  expect(repeat.state).toBe("pending");
});

test("recovery stops asking about a declined form two hours after its purchase", async () => {
  const start = world.time();
  try {
    const s = await world.scenario();
    value(await s.payments.purchase(s.buyer, s.command));
    const paymentId = s.paymentId();
    await s.notify("REJECTED");
    s.setStatus("REJECTED");
    const requested: string[] = [];
    s.afterState((id) => requested.push(id));
    const askedAt = async (offset: number) => {
      world.setTime(new Date(start.getTime() + offset));
      const before = requested.filter((id) => id === paymentId).length;
      value(await s.payments.recover());
      return requested.filter((id) => id === paymentId).length - before;
    };
    expect(await askedAt(105 * minute)).toBe(1);
    // Шаг опроса наступил, но окно формы с запасом уже кончилось.
    expect(await askedAt(121 * minute)).toBe(0);
  } finally {
    world.setTime(start);
  }
});

test("recovery stops cancelling a retired form two hours after its retirement", async () => {
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
    // Оплата первой формы снимает повторную попытку, а её форма ждёт Cancel сверки.
    expect(await s.notify("CONFIRMED", firstPayment)).toMatchObject({
      ok: true,
    });
    expect(
      await world.eventPayload(repeat.purchaseRef, "bank_cancel_requested"),
    ).not.toBeNull();
    world.setTime(new Date(start.getTime() + 121 * minute));
    value(await s.payments.recover());
    expect(s.cancelRequests()).toEqual([]);
  } finally {
    world.setTime(start);
  }
});
