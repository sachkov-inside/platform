import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
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
