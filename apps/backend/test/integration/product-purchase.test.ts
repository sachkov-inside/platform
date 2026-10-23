import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";
import { pressedPaymentButton } from "./setup/consent-documents.js";
import {
  createProductCommerceFixture,
  commerceValue as value,
} from "./setup/product-commerce.js";
const owner = randomUUID();
let db: TestDatabase;
let scenario: ReturnType<typeof createProductCommerceFixture>["scenario"];
beforeAll(async () => {
  db = await createMigratedTestDatabase();
  await db.prisma.account.create({
    data: {
      id: owner,
      logtoIssuer: "https://identity.invalid",
      logtoSubject: owner,
    },
  });
  await db.prisma.accountPermission.create({
    data: { accountId: owner, permission: "platform:admin" },
  });
  scenario = createProductCommerceFixture(db, owner).scenario;
});
afterAll(async () => db.dispose());
test("concurrent Product purchase, verified confirmation, replay and fulfillment yield one lifetime right and immutable Order Email", async () => {
  const s = await scenario();
  const started = await Promise.all([
    s.payments.purchase(s.buyer, s.command),
    s.payments.purchase(s.buyer, s.command),
  ]);
  expect(started.every((r) => r.ok)).toBe(true);
  expect(s.initCalls()).toBe(1);
  const purchase = value(started[0]!);
  expect(
    value(await s.payments.status(s.buyer, purchase.purchaseRef)).access,
  ).toBe("awaiting_payment");
  expect(
    await s.payments.purchaseEmail(s.buyer, purchase.purchaseRef),
  ).toMatchObject({ ok: true, value: "order@example.test" });
  expect(await s.notify("AUTHORIZED")).toMatchObject({ ok: true });
  expect(
    value(await s.payments.status(s.buyer, purchase.purchaseRef)).access,
  ).toBe("awaiting_payment");
  expect(await s.notify("CONFIRMED")).toMatchObject({ ok: true });
  expect(await s.notify("CONFIRMED")).toMatchObject({ ok: true });
  expect(
    value(await s.payments.status(s.buyer, purchase.purchaseRef)).access,
  ).toBe("preparing");
  expect(value(await s.payments.recover()).applied).toBeGreaterThan(0);
  expect(
    value(await s.payments.status(s.buyer, purchase.purchaseRef)),
  ).toMatchObject({
    access: "ready",
    confirmedAt: "2030-01-31T10:00:00.000Z",
    periodEndsAt: null,
  });
  const right = await s.grants.readProductAccess(owner, {
    accountId: s.buyer,
    productId: s.productId,
  });
  expect(right).toMatchObject({
    ok: true,
    value: { access: "active", firstIssuedAt: "2030-01-31T10:00:00.000Z" },
  });
  expect(await s.payments.status(owner, purchase.purchaseRef)).toMatchObject({
    ok: false,
    error: { code: "not_found" },
  });
  const otherQuote = value(
    await s.pricing.quote(s.buyer, {
      operationId: randomUUID(),
      productId: s.productId,
      priceRevision: 1,
    }),
  );
  expect(
    await s.payments.purchase(s.buyer, {
      ...s.command,
      operationId: randomUUID(),
      quoteRef: otherQuote.quoteRef,
    }),
  ).toMatchObject({ ok: false, error: { code: "consent_required" } });
});
test("lost Init answer reconciles the sent operation without a second Init; crash fulfillment recovers after sales close", async () => {
  const s = await scenario();
  s.loseInit();
  const started = await s.payments.purchase(s.buyer, s.command);
  expect(started).toMatchObject({ ok: true, value: { state: "unknown" } });
  const ref = value(started).purchaseRef;
  value(
    await s.pricing.manage(owner, {
      operation: "productPrices.save",
      operationId: randomUUID(),
      expectedRevision: 1,
      value: {
        productId: s.productId,
        name: "Новая цена",
        priceKopecks: 300000,
        published: false,
      },
    }),
  );
  s.setStatus("CONFIRMED");
  expect(await s.payments.reconcile(ref)).toMatchObject({ ok: true });
  expect(value(await s.payments.recover()).applied).toBeGreaterThan(0);
  expect(s.initCalls()).toBe(1);
  expect(s.stateCalls()).toBeGreaterThan(0);
  expect(value(await s.payments.status(s.buyer, ref))).toMatchObject({
    access: "ready",
    snapshot: { firstPriceKopecks: 200000, product: { name: "Курс" } },
  });
});
test("wrong bank amount/terminal/payment binding and receipt never create access", async () => {
  const s = await scenario();
  const purchase = value(await s.payments.purchase(s.buyer, s.command));
  expect(await s.notify("CONFIRMED", { Amount: 199999 })).toMatchObject({
    ok: false,
    error: { code: "invalid_notification" },
  });
  expect(await s.notify("CONFIRMED", { TerminalKey: "OTHER" })).toMatchObject({
    ok: false,
    error: { code: "invalid_notification" },
  });
  expect(await s.notify("CONFIRMED", { PaymentId: "other" })).toMatchObject({
    ok: false,
    error: { code: "invalid_notification" },
  });
  expect(await s.notify("RECEIPT")).toMatchObject({ ok: true });
  expect(
    value(await s.payments.status(s.buyer, purchase.purchaseRef)).access,
  ).toBe("awaiting_payment");
});
test("bank refund is a financial fact and does not revoke the Product", async () => {
  const s = await scenario();
  const purchase = value(await s.payments.purchase(s.buyer, s.command));
  await s.notify("CONFIRMED");
  await s.payments.recover();
  expect(await s.notify("REFUNDED")).toMatchObject({ ok: true });
  expect(
    value(await s.payments.status(s.buyer, purchase.purchaseRef)),
  ).toMatchObject({ access: "ready", refundedKopecks: 200000 });
  expect(
    await s.grants.readProductAccess(owner, {
      accountId: s.buyer,
      productId: s.productId,
    }),
  ).toMatchObject({ ok: true, value: { access: "active" } });
});

test("one best Promotion is reserved once under concurrent buyers without stacking discounts", async () => {
  const first = await scenario({ discount: 50, usageLimit: 1 });
  const second = await scenario({ productId: first.productId });
  expect(first.quote.snapshot.firstPriceKopecks).toBe(100000);
  expect(second.quote.snapshot.firstPriceKopecks).toBe(100000);
  const results = await Promise.all([
    first.payments.purchase(first.buyer, first.command),
    second.payments.purchase(second.buyer, second.command),
  ]);
  expect(results.filter((r) => r.ok)).toHaveLength(1);
  expect(first.initCalls() + second.initCalls()).toBe(1);
  expect(results.find((r) => !r.ok)).toMatchObject({
    ok: false,
    error: { code: "quote_changed" },
  });
});
test("transferable saved-price Payment Link cannot bypass closed Product sales", async () => {
  const s = await scenario();
  const link = value(
    await s.pricing.managePaymentLink(owner, {
      operation: "paymentLinks.create",
      operationId: randomUUID(),
      productId: s.productId,
      priceRevision: 1,
      price: { kind: "amount", amountKopecks: 100000 },
      expiresAt: null,
    }),
  );
  value(
    await s.pricing.manage(owner, {
      operation: "productPrices.save",
      operationId: randomUUID(),
      expectedRevision: 1,
      value: {
        productId: s.productId,
        name: "Курс",
        priceKopecks: 300000,
        published: false,
      },
    }),
  );
  expect(
    await s.pricing.quote(s.buyer, {
      operationId: randomUUID(),
      productId: s.productId,
      priceRevision: 1,
      paymentLinkId: link.id,
    }),
  ).toMatchObject({ ok: false, error: { code: "not_found" } });
});
test("a definitive failed purchase admits a new quote and a new attempt", async () => {
  const s = await scenario();
  const first = value(await s.payments.purchase(s.buyer, s.command));
  await s.notify("REJECTED");
  const quote = value(
    await s.pricing.quote(s.buyer, {
      operationId: randomUUID(),
      productId: s.productId,
      priceRevision: 1,
    }),
  );
  const consent = await s.contact.acceptConsents(
    s.buyer,
    pressedPaymentButton({
      operationId: randomUUID(),
      contextRef: quote.quoteRef,
      documents: [
        {
          kind: "terms",
          documentId: s.document.documentId,
          version: s.document.version,
          digest: s.document.digest,
          accepted: true,
        },
      ],
    }),
  );
  if (!consent.ok) throw new Error(consent.error.code);
  const retry = value(
    await s.payments.purchase(s.buyer, {
      ...s.command,
      operationId: randomUUID(),
      quoteRef: quote.quoteRef,
      consentEvidenceRefs: consent.evidenceRefs,
    }),
  );
  expect(retry.purchaseRef).not.toBe(first.purchaseRef);
  expect(s.initCalls()).toBe(2);
});

test("an archived Product blocks a new accepted quote while preserving existing holders", async () => {
  const s = await scenario();
  await db.prisma.product.update({
    where: { id: s.productId },
    data: { archivedAt: new Date("2030-01-31T10:00:00Z") },
  });
  expect(await s.payments.purchase(s.buyer, s.command)).toMatchObject({
    ok: false,
    error: { code: "not_found" },
  });
  expect(s.initCalls()).toBe(0);
});
test("a holder cannot buy the Product again even by acknowledging existing access", async () => {
  const s = await scenario();
  value(await s.payments.purchase(s.buyer, s.command));
  await s.notify("CONFIRMED");
  await s.payments.recover();
  const quote = value(
    await s.pricing.quote(s.buyer, {
      operationId: randomUUID(),
      productId: s.productId,
      priceRevision: 1,
    }),
  );
  const consent = await s.contact.acceptConsents(
    s.buyer,
    pressedPaymentButton({
      operationId: randomUUID(),
      contextRef: quote.quoteRef,
      documents: [
        {
          kind: "terms",
          documentId: s.document.documentId,
          version: s.document.version,
          digest: s.document.digest,
          accepted: true,
        },
      ],
    }),
  );
  if (!consent.ok) throw new Error(consent.error.code);
  expect(
    await s.payments.purchase(s.buyer, {
      ...s.command,
      operationId: randomUUID(),
      quoteRef: quote.quoteRef,
      consentEvidenceRefs: consent.evidenceRefs,
      acknowledgeExistingAccess: true,
    }),
  ).toMatchObject({ ok: false, error: { code: "existing_access" } });
  expect(s.initCalls()).toBe(1);
});
