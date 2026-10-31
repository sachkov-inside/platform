import { afterAll, afterEach, beforeAll, expect, test } from "vitest";
import { CoverageCatalog } from "../../src/modules/materials/index.js";
import { ProductDiscovery } from "../../src/modules/products/index.js";
import { BillingPayments } from "../../src/modules/billing/index.js";
import {
  createProductCommerceWorld,
  commerceValue as value,
} from "./setup/product-commerce.js";

/**
 * Init, после которого в банке нет платежа, не держит покупку в `unknown` (#1922). Отказ до
 * отправки и отказ банка без PaymentId закрывают покупку сразу. Неизвестный исход закрывает
 * только пустой ответ CheckOrder через 30 минут после первого пустого ответа.
 */
let world: Awaited<ReturnType<typeof createProductCommerceWorld>>;
let start: Date;
beforeAll(async () => {
  world = await createProductCommerceWorld();
  start = world.time();
});
// Каждый тест задаёт свои часы; следующий начинает с исходного времени мира.
afterEach(() => world.setTime(start));
afterAll(async () => world.dispose());

type Scenario = Awaited<ReturnType<typeof world.scenario>>;
const minute = 60_000;

async function purchaseRow(purchaseRef: string) {
  return world.db.prisma.billingPurchase.findUniqueOrThrow({
    where: { id: purchaseRef },
    select: { state: true, paymentId: true, paymentUrl: true },
  });
}

async function events(purchaseRef: string) {
  const rows = await world.db.prisma.billingPaymentEvent.findMany({
    where: { purchaseRef },
    select: { kind: true, payload: true },
    orderBy: { kind: "asc" },
  });
  return rows.map((row) => ({ kind: row.kind, payload: row.payload }));
}

/** Покупатель начинает покупку заново, и новый Init открывает форму оплаты. */
async function expectNewPurchase(s: Scenario, closedRef: string) {
  const initCalls = s.initCalls();
  const next = value(
    await s.payments.purchase(s.buyer, await s.repeatCommand()),
  );
  expect(next.purchaseRef).not.toBe(closedRef);
  expect(next).toMatchObject({ state: "pending" });
  expect(next.paymentUrl).toEqual(expect.any(String));
  expect(s.initCalls()).toBe(initCalls + 1);
}

test("a bank refusal of Init with an error code and no PaymentId closes the purchase, and the buyer can buy again", async () => {
  world.setTime(new Date("2030-02-01T10:00:00Z"));
  const s = await world.scenario();
  s.failNextInit({ errorCode: "9999", message: "Неверные параметры" });
  const refused = value(await s.payments.purchase(s.buyer, s.command));
  expect(refused).toMatchObject({ state: "failed", paymentUrl: null });
  expect(await purchaseRow(refused.purchaseRef)).toEqual({
    state: "failed",
    paymentId: null,
    paymentUrl: null,
  });
  expect(await events(refused.purchaseRef)).toEqual([
    {
      kind: "bank_payment_absent",
      payload: {
        reason: "init_declined",
        errorCode: "9999",
        message: "Неверные параметры",
      },
    },
  ]);
  await expectNewPurchase(s, refused.purchaseRef);
});

test("a failure while preparing Init closes the purchase without a bank request, and the buyer can buy again", async () => {
  world.setTime(new Date("2030-02-01T10:00:00Z"));
  const s = await world.scenario();
  const catalog = new CoverageCatalog(
    world.db.prisma,
    new ProductDiscovery(world.db.prisma),
  );
  const unprepared = new BillingPayments({
    prisma: world.db.prisma,
    bank: s.bank,
    contact: s.contact,
    grants: s.grants,
    clock: world.time,
    // Допуск к продаже читает каталог в транзакции резерва. Страницу возврата для Init покупка
    // читает уже после резерва и вне транзакции: этот запрос и падает.
    contentCatalog: {
      resolveMany: catalog.resolveMany.bind(catalog),
      resolve: (...args: Parameters<typeof catalog.resolve>) =>
        args[1] === undefined
          ? Promise.reject(new Error("Synthetic catalog failure before Init"))
          : catalog.resolve(...args),
    },
  });
  const closed = value(await unprepared.purchase(s.buyer, s.command));
  expect(closed).toMatchObject({ state: "failed", paymentUrl: null });
  expect(s.initCalls()).toBe(0);
  expect(await purchaseRow(closed.purchaseRef)).toEqual({
    state: "failed",
    paymentId: null,
    paymentUrl: null,
  });
  expect(await events(closed.purchaseRef)).toEqual([
    { kind: "bank_payment_absent", payload: { reason: "init_not_sent" } },
  ]);
  await expectNewPurchase(s, closed.purchaseRef);
});

async function reconcileAt(s: Scenario, purchaseRef: string, at: Date) {
  world.setTime(at);
  return s.payments.reconcile(purchaseRef);
}

test.each(["unreachable", "unavailable"] as const)(
  "an Init without a bank answer (%s) stays unknown until CheckOrder finds no payment for 30 minutes, then the buyer can buy again",
  async (failure) => {
    const createdAt = new Date("2030-02-01T10:00:00Z");
    world.setTime(createdAt);
    const s = await world.scenario();
    s.failNextInit(failure);
    const purchase = value(await s.payments.purchase(s.buyer, s.command));
    expect(purchase).toMatchObject({ state: "unknown", paymentUrl: null });
    const firstEmptyAt = new Date(createdAt.getTime() + minute);
    expect(await reconcileAt(s, purchase.purchaseRef, firstEmptyAt)).toEqual({
      ok: false,
      error: { code: "provider_unavailable" },
    });
    expect(
      await reconcileAt(
        s,
        purchase.purchaseRef,
        new Date(firstEmptyAt.getTime() + 30 * minute - 1),
      ),
    ).toEqual({ ok: false, error: { code: "provider_unavailable" } });
    expect((await purchaseRow(purchase.purchaseRef)).state).toBe("unknown");
    expect(
      await reconcileAt(
        s,
        purchase.purchaseRef,
        new Date(firstEmptyAt.getTime() + 30 * minute),
      ),
    ).toEqual({ ok: true, value: true });
    expect(await purchaseRow(purchase.purchaseRef)).toEqual({
      state: "failed",
      paymentId: null,
      paymentUrl: null,
    });
    expect(await events(purchase.purchaseRef)).toEqual([
      { kind: "bank_order_empty", payload: {} },
      {
        kind: "bank_payment_absent",
        payload: {
          reason: "check_order_empty",
          firstEmptyAt: firstEmptyAt.toISOString(),
        },
      },
    ]);
    // Закрытая покупка больше не отвечает сверке отказом банка.
    expect(await s.payments.reconcile(purchase.purchaseRef)).toEqual({
      ok: true,
      value: true,
    });
    await expectNewPurchase(s, purchase.purchaseRef);
  },
);

test("an empty CheckOrder long after the purchase was created still waits 30 minutes from its first empty answer", async () => {
  const createdAt = new Date("2030-02-01T10:00:00Z");
  world.setTime(createdAt);
  const s = await world.scenario();
  s.failNextInit("unreachable");
  const purchase = value(await s.payments.purchase(s.buyer, s.command));
  const firstEmptyAt = new Date(createdAt.getTime() + 120 * minute);
  await reconcileAt(s, purchase.purchaseRef, firstEmptyAt);
  expect(
    await reconcileAt(
      s,
      purchase.purchaseRef,
      new Date(firstEmptyAt.getTime() + 29 * minute),
    ),
  ).toEqual({ ok: false, error: { code: "provider_unavailable" } });
  expect((await purchaseRow(purchase.purchaseRef)).state).toBe("unknown");
  value(
    await reconcileAt(
      s,
      purchase.purchaseRef,
      new Date(firstEmptyAt.getTime() + 30 * minute),
    ),
  );
  expect((await purchaseRow(purchase.purchaseRef)).state).toBe("failed");
});

test("a purchase left in sent by a process crash during Init is closed by the same 30-minute window", async () => {
  const createdAt = new Date("2030-02-01T10:00:00Z");
  world.setTime(createdAt);
  const s = await world.scenario();
  s.failNextInit("unreachable");
  const purchase = value(await s.payments.purchase(s.buyer, s.command));
  // Процесс упал после отметки sent и до записи исхода Init.
  await world.db.prisma.billingPurchase.update({
    where: { id: purchase.purchaseRef },
    data: { state: "sent" },
  });
  const firstEmptyAt = new Date(createdAt.getTime() + minute);
  await reconcileAt(s, purchase.purchaseRef, firstEmptyAt);
  expect((await purchaseRow(purchase.purchaseRef)).state).toBe("sent");
  value(
    await reconcileAt(
      s,
      purchase.purchaseRef,
      new Date(firstEmptyAt.getTime() + 30 * minute),
    ),
  );
  expect((await purchaseRow(purchase.purchaseRef)).state).toBe("failed");
  expect(
    (await events(purchase.purchaseRef)).map((event) => event.kind),
  ).toEqual(["bank_order_empty", "bank_payment_absent"]);
});

test("a lost Init answer whose payment the bank created is found by CheckOrder and never closed as absent", async () => {
  const createdAt = new Date("2030-02-01T10:00:00Z");
  world.setTime(createdAt);
  const s = await world.scenario();
  s.loseInit();
  const purchase = value(await s.payments.purchase(s.buyer, s.command));
  expect(purchase).toMatchObject({ state: "unknown" });
  value(
    await reconcileAt(
      s,
      purchase.purchaseRef,
      new Date(createdAt.getTime() + 60 * minute),
    ),
  );
  // Платёж найден, поэтому окно отсутствия не закрывает попытку. Адреса формы у Inside нет:
  // через 2 минуты после создания сверка снимает её и отменяет форму в банке (#1926).
  expect(await purchaseRow(purchase.purchaseRef)).toMatchObject({
    state: "failed",
    paymentId: s.paymentId(),
  });
  expect(await events(purchase.purchaseRef)).toEqual([
    {
      kind: "bank_cancel_confirmed",
      payload: { paymentId: s.paymentId(), status: "CANCELED" },
    },
    { kind: "bank_cancel_requested", payload: { reason: "form_address_lost" } },
    { kind: "form_address_lost", payload: {} },
  ]);
});
