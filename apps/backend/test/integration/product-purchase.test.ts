import { BillingPayments } from "../../src/modules/billing/index.js";
import { Tbank } from "../../src/modules/billing/infrastructure/tbank/tbank.js";
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
  const purchase = value(started[0]);
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

test("the actual published legal catalog refuses fresh Product payment including a private link without Init", async () => {
  const { consentDocuments } = await import("@inside/legal");
  const s = await scenario({
    legalDocuments: consentDocuments("https://inside.example.test"),
  });
  expect(s.document.commercialModel).toBeUndefined();
  expect(await s.payments.purchase(s.buyer, s.command)).toMatchObject({
    ok: false,
    error: { code: "method_unavailable" },
  });
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
  const quote = value(
    await s.pricing.quote(s.buyer, {
      operationId: randomUUID(),
      productId: s.productId,
      priceRevision: 1,
      paymentLinkId: link.id,
    }),
  );
  expect(
    await s.payments.purchase(s.buyer, {
      ...s.command,
      operationId: randomUUID(),
      quoteRef: quote.quoteRef,
    }),
  ).toMatchObject({ ok: false, error: { code: "method_unavailable" } });
  expect(s.initCalls()).toBe(0);
  expect(
    await db.prisma.billingPurchase.count({ where: { accountId: s.buyer } }),
  ).toBe(0);
});

test("a distinct approved-model synthetic legal edition is persisted from the server catalog", async () => {
  const s = await scenario();
  expect(s.document.commercialModel).toBe("product-lifetime-v1");
  expect(s.document.version).toBe("test-v1");
  expect(s.document.text).toContain("Synthetic");
  const purchase = value(await s.payments.purchase(s.buyer, s.command));
  const stored = await db.prisma.billingPurchase.findUniqueOrThrow({
    where: { id: purchase.purchaseRef },
  });
  expect(stored.acceptance).toMatchObject({
    commercialModel: "product-lifetime-v1",
  });
  expect(JSON.stringify(stored.acceptance)).toContain(s.document.digest);
  expect(s.initCalls()).toBe(1);
});

test.each(["refund_first", "refund_before_fulfillment"] as const)(
  "%s preserves paid Product fulfillment independently of the financial refund",
  async (order) => {
    const s = await scenario();
    const purchase = value(await s.payments.purchase(s.buyer, s.command));
    if (order === "refund_before_fulfillment")
      expect(await s.notify("CONFIRMED")).toMatchObject({ ok: true });
    expect(await s.notify("REFUNDED")).toMatchObject({ ok: true });
    expect(await s.notify("REFUNDED")).toMatchObject({ ok: true });
    expect(await s.notify("CONFIRMED")).toMatchObject({ ok: true });
    await s.payments.recover();
    expect(
      value(await s.payments.status(s.buyer, purchase.purchaseRef)),
    ).toMatchObject({ access: "ready", refundedKopecks: 200000 });
    const pair = { accountId: s.buyer, productId: s.productId };
    const right = value(await s.grants.readProductAccess(owner, pair));
    expect(right.access).toBe("active");
    expect(
      await s.grants.revokeProductAccess(owner, {
        ...pair,
        operationId: randomUUID(),
        expectedRevision: right.revision,
        reason: "Explicit owner withdrawal after bank refund",
      }),
    ).toMatchObject({ ok: true });
    await s.payments.recover();
    expect(await s.notify("REFUNDED")).toMatchObject({ ok: true });
    expect(await s.notify("CONFIRMED")).toMatchObject({ ok: true });
    expect(await s.grants.readProductAccess(owner, pair)).toMatchObject({
      ok: true,
      value: { access: "revoked" },
    });
    expect(s.initCalls()).toBe(1);
    expect(
      await db.prisma.billingPaymentEvent.count({
        where: { purchaseRef: purchase.purchaseRef, kind: "payment_confirmed" },
      }),
    ).toBe(1);
    expect(
      await db.prisma.billingRefund.count({
        where: { purchaseRef: purchase.purchaseRef },
      }),
    ).toBe(1);
  },
);

test.each(["product_capabilities", "explicit_coverage"] as const)(
  "a sent historical one-time bundle (%s) fulfills each explicit saved Product once and preserves owner withdrawal",
  async (scope) => {
    const s = await scenario();
    const secondProduct = randomUUID();
    await db.prisma.product.create({
      data: {
        id: secondProduct,
        name: "Historical second Product",
        slug: secondProduct,
      },
    });
    const {
      product: _product,
      supportMonths: _supportMonths,
      ...legacy
    } = s.quote.snapshot;
    const snapshot = {
      ...legacy,
      offer: {
        ...legacy.offer,
        benefits:
          scope === "product_capabilities"
            ? [`product:${s.productId}`, `product:${secondProduct}`]
            : ["materials"],
        coverage: { productIds: [s.productId, secondProduct], materialIds: [] },
      },
    };
    const purchase = { purchaseRef: randomUUID() };
    const historicalPaymentId = `historical-${purchase.purchaseRef}`;
    const quoteRef = randomUUID();
    const instant = new Date("2030-01-31T10:00:00Z");
    await db.prisma.billingPriceQuote.create({
      data: {
        id: quoteRef,
        accountId: s.buyer,
        operationId: randomUUID(),
        fingerprint: "historical-bundle",
        snapshot,
        createdAt: instant,
        expiresAt: new Date("2030-02-01T00:00:00Z"),
      },
    });
    await db.prisma.billingPurchase.create({
      data: {
        id: purchase.purchaseRef,
        accountId: s.buyer,
        quoteRef,
        kind: "one_time",
        state: "unknown",
        lifecycleActive: false,
        environment: s.config.environment,
        terminalRef: s.config.terminalKey,
        paymentId: historicalPaymentId,
        amountKopecks: 200000,
        snapshot,
        acceptance: { historical: true },
        contact: { email: "historical@example.test" },
        fiscalization: "pending",
        createdAt: instant,
        updatedAt: instant,
      },
    });
    await db.prisma.billingPromoReservation.create({
      data: {
        purchaseRef: purchase.purchaseRef,
        accountId: s.buyer,
        quoteRef,
        state: "unknown",
        snapshot,
      },
    });
    const historicalPayments = new BillingPayments({
      prisma: db.prisma,
      contact: s.contact,
      grants: s.grants,
      clock: () => instant,
      bank: new Tbank(s.config, (url) => {
        if (!url.endsWith("/GetState"))
          throw new Error(
            "Historical recovery cannot send a new Init or charge",
          );
        return Promise.resolve(
          Response.json({
            TerminalKey: s.config.terminalKey,
            OrderId: purchase.purchaseRef,
            PaymentId: historicalPaymentId,
            Amount: 200000,
            Status: "CONFIRMED",
            Success: true,
            ErrorCode: "0",
          }),
        );
      }),
    });
    expect(
      await historicalPayments.reconcile(purchase.purchaseRef),
    ).toMatchObject({ ok: true });
    expect(value(await historicalPayments.recover()).applied).toBe(1);
    for (const productId of [s.productId, secondProduct])
      expect(
        await s.grants.readProductAccess(owner, {
          accountId: s.buyer,
          productId,
        }),
      ).toMatchObject({ ok: true, value: { access: "active" } });
    const pair = { accountId: s.buyer, productId: secondProduct };
    const second = value(await s.grants.readProductAccess(owner, pair));
    await s.grants.revokeProductAccess(owner, {
      ...pair,
      operationId: randomUUID(),
      expectedRevision: second.revision,
      reason: "Explicit withdrawal of second historical Product",
    });
    await historicalPayments.recover();
    expect(await s.grants.readProductAccess(owner, pair)).toMatchObject({
      ok: true,
      value: { access: "revoked" },
    });
    expect(
      await db.prisma.productAccessSource.count({
        where: { accountId: s.buyer },
      }),
    ).toBe(2);
    expect(s.initCalls()).toBe(0);
    expect(
      (
        await db.prisma.billingPurchase.findUniqueOrThrow({
          where: { id: purchase.purchaseRef },
        })
      ).snapshot,
    ).toEqual(snapshot);
  },
);

test.each(["initial", "renewal", "upgrade"])(
  "an unsent historical %s attempt is retired once without starving a current one-time purchase",
  async (kind) => {
    const retired = await scenario();
    const oldRef = randomUUID();
    const subscriptionRef = randomUUID();
    const instant = new Date("2030-01-31T10:00:00.000Z");
    await db.prisma.billingSubscription.create({
      data: {
        id: subscriptionRef,
        accountId: retired.buyer,
        state: "active",
        snapshot: retired.quote.snapshot,
        consent: {},
        anchorAt: instant,
        anchorMonths: 1,
        periodIndex: 1,
        periodStartsAt: instant,
        paidUntil: new Date("2030-02-28T10:00:00Z"),
        periodAmountKopecks: 200000,
        revision: 1,
        createdAt: instant,
        updatedAt: instant,
      },
    });
    await db.prisma.billingPurchase.create({
      data: {
        id: oldRef,
        accountId: retired.buyer,
        quoteRef: kind === "initial" ? retired.quote.quoteRef : null,
        subscriptionRef,
        periodIndex: 1,
        kind,
        state: "prepared",
        lifecycleActive: false,
        environment: retired.config.environment,
        terminalRef: retired.config.terminalKey,
        amountKopecks: 200000,
        snapshot: retired.quote.snapshot,
        acceptance: {},
        contact: {},
        fiscalization: "pending",
        createdAt: instant,
        updatedAt: instant,
      },
    });
    const current = await scenario();
    const currentRef = value(
      await current.payments.purchase(current.buyer, current.command),
    ).purchaseRef;
    await current.notify("CONFIRMED");
    const first = value(await retired.payments.recover());
    expect(first.applied).toBe(1);
    expect(
      (
        await db.prisma.billingPurchase.findUniqueOrThrow({
          where: { id: oldRef },
        })
      ).state,
    ).toBe("failed");
    const after = await db.prisma.billingPurchase.findUniqueOrThrow({
      where: { id: oldRef },
    });
    expect(await retired.payments.recover()).toMatchObject({ ok: true });
    expect(
      await db.prisma.billingPurchase.findUniqueOrThrow({
        where: { id: oldRef },
      }),
    ).toEqual(after);
    expect(
      await db.prisma.billingPaymentEvent.count({
        where: { purchaseRef: oldRef, kind: "legacy_dispatch_retired" },
      }),
    ).toBe(1);
    expect(
      await current.payments.status(current.buyer, currentRef),
    ).toMatchObject({ ok: true, value: { access: "ready" } });
    expect(retired.initCalls()).toBe(0);
  },
);
