import { afterAll, beforeAll, expect, test } from "vitest";

import { lostFormAddressMilliseconds } from "../../src/modules/billing/facets/billing-payments/billing-payments.js";
import { readPayment } from "../../src/modules/billing/features/read-payments/read-payments.js";
import { warnings } from "./setup/log-lines.js";
import {
  createProductCommerceWorld,
  commerceValue as value,
} from "./setup/product-commerce.js";

/**
 * Покупка ждёт оплаты, а адреса формы у Inside нет: ответ Init потерян или адрес не прошёл
 * проверку `formOrigins` (#1926). GetState адрес не возвращает, поэтому через две минуты после
 * создания сверка снимает такую покупку и отменяет её форму в банке (#1923), если банк называет
 * форму неоплаченной. Покупатель начинает покупку заново.
 */
type World = Awaited<ReturnType<typeof createProductCommerceWorld>>;
type Scenario = Awaited<ReturnType<World["scenario"]>>;
let world: World;
beforeAll(async () => {
  world = await createProductCommerceWorld();
});
afterAll(async () => world.dispose());

/** Время теста идёт от `start`; после теста часы мира возвращаются назад. */
async function fromStart(work: (start: Date) => Promise<void>): Promise<void> {
  const start = world.time();
  try {
    await work(start);
  } finally {
    world.setTime(start);
  }
}

function after(start: Date, milliseconds: number): Date {
  return new Date(start.getTime() + milliseconds);
}

/** Банк создал форму, но ответ Init с её адресом до Inside не дошёл. */
async function lostFormAddress(s: Scenario) {
  s.loseInit();
  await s.payments.purchase(s.buyer, s.command);
  s.answerInit();
  const row = await world.db.prisma.billingPurchase.findFirstOrThrow({
    where: { accountId: s.buyer },
    select: { id: true, state: true },
  });
  expect(row.state).toBe("unknown");
  return { purchaseRef: row.id, paymentId: s.paymentId() };
}

test.each(["NEW", "FORM_SHOWED"])(
  "recovery retires a purchase without a form address two minutes after creation and cancels its %s form",
  async (formStatus) => {
    await fromStart(async (start) => {
      const s = await world.scenario();
      const { purchaseRef, paymentId } = await lostFormAddress(s);
      s.setPaymentStatus(paymentId, formStatus);
      value(await s.payments.recover());
      expect(await world.purchaseRow(purchaseRef)).toEqual({
        state: "pending",
        paymentId,
        paymentUrl: null,
      });
      world.setTime(after(start, lostFormAddressMilliseconds - 1));
      value(await s.payments.recover());
      expect((await world.purchaseRow(purchaseRef)).state).toBe("pending");
      expect(s.cancelRequests()).toEqual([]);

      world.setTime(after(start, lostFormAddressMilliseconds));
      value(await s.payments.recover());
      expect(await world.purchaseRow(purchaseRef)).toEqual({
        state: "failed",
        paymentId,
        paymentUrl: null,
      });
      expect(
        await world.eventPayload(purchaseRef, "form_address_lost"),
      ).toEqual({});
      expect(
        await world.eventPayload(purchaseRef, "bank_cancel_requested"),
      ).toEqual({
        reason: "form_address_lost",
      });
      expect(s.cancelRequests()).toMatchObject([{ PaymentId: paymentId }]);
      expect(
        await world.eventPayload(purchaseRef, "bank_cancel_confirmed"),
      ).toEqual({
        paymentId,
        status: "CANCELED",
      });
      expect(await s.payments.status(s.buyer, purchaseRef)).toMatchObject({
        ok: true,
        value: {
          state: "failed",
          paymentUrl: null,
          retirementReason: "form_address_lost",
        },
      });
    });
  },
);

test("after the retirement the buyer starts a new purchase with its own payment form", async () => {
  await fromStart(async (start) => {
    const s = await world.scenario();
    const { purchaseRef } = await lostFormAddress(s);
    world.setTime(after(start, lostFormAddressMilliseconds));
    value(await s.payments.reconcile(purchaseRef));
    expect((await world.purchaseRow(purchaseRef)).state).toBe("failed");

    const repeat = value(
      await s.payments.purchase(s.buyer, await s.repeatCommand()),
    );
    expect(repeat.purchaseRef).not.toBe(purchaseRef);
    expect(repeat).toMatchObject({
      state: "pending",
      paymentUrl: "https://securepay.tinkoff.ru/test",
    });
  });
});

test("a buyer repeating the command after two minutes sees the retired purchase without waiting for the Cancel", async () => {
  await fromStart(async (start) => {
    const s = await world.scenario();
    const { purchaseRef, paymentId } = await lostFormAddress(s);
    world.setTime(after(start, lostFormAddressMilliseconds));
    expect(await s.payments.purchase(s.buyer, s.command)).toMatchObject({
      ok: true,
      value: {
        purchaseRef,
        state: "failed",
        retirementReason: "form_address_lost",
      },
    });
    // Запрос покупателя Cancel не шлёт: форму закрывает фоновая сверка.
    expect(s.cancelRequests()).toEqual([]);
    value(await s.payments.reconcile(purchaseRef));
    expect(s.cancelRequests()).toMatchObject([{ PaymentId: paymentId }]);
  });
});

test.each(["3DS_CHECKING", "AUTHORIZING", "AUTHORIZED", "PAY_CHECKING"])(
  "a purchase without a form address stays open while the bank reports %s",
  async (bankStatus) => {
    await fromStart(async (start) => {
      const s = await world.scenario();
      const { purchaseRef, paymentId } = await lostFormAddress(s);
      s.setPaymentStatus(paymentId, bankStatus);
      world.setTime(after(start, 10 * lostFormAddressMilliseconds));
      value(await s.payments.reconcile(purchaseRef));
      expect((await world.purchaseRow(purchaseRef)).state).not.toBe("failed");
      expect(
        await world.eventPayload(purchaseRef, "form_address_lost"),
      ).toBeNull();
      expect(s.cancelRequests()).toEqual([]);
    });
  },
);

test("a purchase with a stored form address is never retired by the wait", async () => {
  await fromStart(async (start) => {
    const s = await world.scenario();
    const purchase = value(await s.payments.purchase(s.buyer, s.command));
    world.setTime(after(start, 10 * lostFormAddressMilliseconds));
    value(await s.payments.reconcile(purchase.purchaseRef));
    expect(await world.purchaseRow(purchase.purchaseRef)).toEqual({
      state: "pending",
      paymentId: s.paymentId(),
      paymentUrl: "https://securepay.tinkoff.ru/test",
    });
    expect(s.cancelRequests()).toEqual([]);
  });
});

test("a form address outside formOrigins asks for operator attention and the purchase is retired like a lost one", async () => {
  await fromStart(async (start) => {
    const s = await world.scenario();
    s.setFormAddress("https://pay.evil.test/new/form?token=secret");
    const { lines } = await warnings(() =>
      s.payments.purchase(s.buyer, s.command),
    );
    const row = await world.db.prisma.billingPurchase.findFirstOrThrow({
      where: { accountId: s.buyer },
      select: { id: true, state: true, paymentUrl: true },
    });
    expect(row).toMatchObject({ state: "unknown", paymentUrl: null });
    // Путь и параметры адреса в журнал не попадают: в них может быть ключ формы.
    expect(lines).toContainEqual({
      time: expect.any(String) as unknown,
      level: "warn",
      event: "bank_payment_url_rejected",
      module: "billing",
      status: "operator_attention",
      purchaseRef: row.id,
      origin: "https://pay.evil.test",
    });

    world.setTime(after(start, lostFormAddressMilliseconds));
    value(await s.payments.reconcile(row.id));
    expect((await world.purchaseRow(row.id)).state).toBe("failed");
    expect(s.cancelRequests()).toMatchObject([{ PaymentId: s.paymentId() }]);
  });
});

test("a form retired by recovery late in its recheck window whose Cancel fails is asked again on the first step after the retirement", async () => {
  await fromStart(async (start) => {
    const s = await world.scenario();
    const { purchaseRef, paymentId } = await lostFormAddress(s);
    s.setPaymentStatus(paymentId, "NEW");
    value(await s.payments.recover());
    // Покупка ждёт полтора часа, затем сверка снимает её, а Cancel не проходит.
    const retiredAt = after(start, 90 * 60_000);
    world.setTime(retiredAt);
    s.failCancel(1);
    value(await s.payments.recover());
    expect((await world.purchaseRow(purchaseRef)).state).toBe("failed");
    expect(s.cancelRequests()).toHaveLength(1);
    // Повтор отсчитывается от снятия, а не от создания покупки.
    world.setTime(after(retiredAt, 60_000));
    value(await s.payments.recover());
    expect(s.cancelRequests()).toHaveLength(2);
  });
});

const formAddress = "https://securepay.tinkoff.ru/test";

/** Виды событий покупки в карточке платежа владельца, в порядке записи. */
async function ownerEventKinds(purchaseRef: string): Promise<string[]> {
  const payment = await readPayment(world.db.prisma, purchaseRef);
  if (!payment.ok) throw new Error("payment card is unavailable");
  return payment.result.events.map((event) => event.kind);
}

test.each(["3DS_CHECKING", "3DS_CHECKED", "AUTHORIZING", "PREAUTHORIZING"])(
  "an intermediate bank status (%s) keeps the stored form address, and the buyer returns to the same form",
  async (status) => {
    await fromStart(async (start) => {
      const s = await world.scenario();
      const purchase = value(await s.payments.purchase(s.buyer, s.command));
      expect(await s.notify(status)).toEqual({ ok: true, value: true });
      expect(await world.purchaseRow(purchase.purchaseRef)).toEqual({
        state: "pending",
        paymentId: s.paymentId(),
        paymentUrl: formAddress,
      });
      // Проверка не прошла, и банк вернул покупателя на ту же форму.
      s.setStatus("FORM_SHOWED");
      world.setTime(after(start, 10 * lostFormAddressMilliseconds));
      value(await s.payments.reconcile(purchase.purchaseRef));
      expect(
        value(await s.payments.status(s.buyer, purchase.purchaseRef)),
      ).toMatchObject({
        state: "pending",
        paymentUrl: formAddress,
        retirementReason: null,
      });
      expect(s.cancelRequests()).toEqual([]);
    });
  },
);

test.each(["PAY_CHECKING", "CONFIRM_CHECKING"])(
  "an undecided bank status (%s) keeps the stored form address, and a later unpaid answer reopens the same form",
  async (status) => {
    await fromStart(async (start) => {
      const s = await world.scenario();
      const purchase = value(await s.payments.purchase(s.buyer, s.command));
      expect(await s.notify(status)).toEqual({ ok: true, value: true });
      expect(await world.purchaseRow(purchase.purchaseRef)).toEqual({
        state: "unknown",
        paymentId: s.paymentId(),
        paymentUrl: formAddress,
      });
      // Пока исход неизвестен, покупатель форму не получает.
      expect(
        value(await s.payments.status(s.buyer, purchase.purchaseRef))
          .paymentUrl,
      ).toBeNull();
      s.setStatus("NEW");
      world.setTime(after(start, 10 * lostFormAddressMilliseconds));
      value(await s.payments.reconcile(purchase.purchaseRef));
      expect(await world.purchaseRow(purchase.purchaseRef)).toEqual({
        state: "pending",
        paymentId: s.paymentId(),
        paymentUrl: formAddress,
      });
      expect(s.cancelRequests()).toEqual([]);
    });
  },
);

test("the owner's payment card records once that Inside received the form address", async () => {
  const s = await world.scenario();
  const purchase = value(await s.payments.purchase(s.buyer, s.command));
  // Повтор той же команды возвращает ту же форму и второй отметки не пишет.
  value(await s.payments.purchase(s.buyer, s.command));
  expect(await s.notify("FORM_SHOWED")).toEqual({ ok: true, value: true });
  expect(await ownerEventKinds(purchase.purchaseRef)).toEqual([
    "form_address_received",
  ]);
});

test("an attempt whose form address Inside once received is not retired as lost after the stored address is gone", async () => {
  await fromStart(async (start) => {
    const s = await world.scenario();
    const purchase = value(await s.payments.purchase(s.buyer, s.command));
    // Удержание денег стирает адрес, затем исход становится неизвестным.
    expect(await s.notify("AUTHORIZED")).toEqual({ ok: true, value: true });
    expect(await s.notify("PAY_CHECKING")).toEqual({ ok: true, value: true });
    expect(await world.purchaseRow(purchase.purchaseRef)).toEqual({
      state: "unknown",
      paymentId: s.paymentId(),
      paymentUrl: null,
    });
    s.setStatus("FORM_SHOWED");
    world.setTime(after(start, 10 * lostFormAddressMilliseconds));
    value(await s.payments.reconcile(purchase.purchaseRef));
    expect((await world.purchaseRow(purchase.purchaseRef)).state).toBe(
      "pending",
    );
    expect(
      await world.eventPayload(purchase.purchaseRef, "form_address_lost"),
    ).toBeNull();
    expect(s.cancelRequests()).toEqual([]);
  });
});

test("a purchase whose form address never arrived has no received-address mark", async () => {
  const s = await world.scenario();
  const { purchaseRef } = await lostFormAddress(s);
  expect(await ownerEventKinds(purchaseRef)).not.toContain(
    "form_address_received",
  );
});
