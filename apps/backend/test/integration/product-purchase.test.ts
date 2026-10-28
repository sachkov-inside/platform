import { CoverageCatalog } from "../../src/modules/materials/index.js";
import { ProductDiscovery } from "../../src/modules/products/index.js";
import type { Prisma } from "../../src/infrastructure/prisma/index.js";
import { BillingPayments } from "../../src/modules/billing/index.js";
import { BillingContact } from "../../src/modules/accounts/index.js";
import { billingContactProtection } from "../../src/modules/accounts/infrastructure/billing-contact-protection.js";
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

test("the published purchase v7 catalog admits a fresh Product payment and a private link with exact v7 acceptance", async () => {
  const { consentDocuments, currentLegalEdition } =
    await import("@inside/legal");
  const published = currentLegalEdition("purchase");
  const s = await scenario({
    legalDocuments: consentDocuments("https://inside.example.test"),
  });
  expect(s.document).toMatchObject({
    documentId: "purchase",
    version: "7",
    digest: published.digest,
    url: "https://inside.example.test/legal/purchase/v7",
    commercialModel: "product-lifetime-v1",
  });
  expect(s.contact.hasApprovedProductTerms()).toBe(true);
  const purchase = value(await s.payments.purchase(s.buyer, s.command));
  expect(s.initCalls()).toBe(1);
  const stored = await db.prisma.billingPurchase.findUniqueOrThrow({
    where: { id: purchase.purchaseRef },
  });
  expect(stored.acceptance).toMatchObject({
    commercialModel: "product-lifetime-v1",
  });
  const acceptance = JSON.stringify(stored.acceptance);
  expect(acceptance).toContain(published.digest);
  expect(acceptance).toContain("/legal/purchase/v7");

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
  const viaLink = await scenario({
    productId: s.productId,
    paymentLinkId: link.id,
    legalDocuments: consentDocuments("https://inside.example.test"),
  });
  expect(viaLink.quote.snapshot.firstPriceKopecks).toBe(100000);
  const linkPurchase = value(
    await viaLink.payments.purchase(viaLink.buyer, viaLink.command),
  );
  expect(viaLink.initCalls()).toBe(1);
  expect(
    JSON.stringify(
      (
        await db.prisma.billingPurchase.findUniqueOrThrow({
          where: { id: linkPurchase.purchaseRef },
        })
      ).acceptance,
    ),
  ).toContain(published.digest);
});

test("a purchase sent on an earlier edition is confirmed on it after purchase v7 takes effect, without a new Init", async () => {
  const { consentDocuments } = await import("@inside/legal");
  const s = await scenario();
  const earlier = s.document;
  s.loseInit();
  const started = await s.payments.purchase(s.buyer, s.command);
  expect(started).toMatchObject({ ok: true, value: { state: "unknown" } });
  const ref = value(started).purchaseRef;
  // Release: the API now serves the published catalog, and the sent operation is recovered there.
  const released = new BillingPayments({
    contentCatalog: new CoverageCatalog(
      db.prisma,
      new ProductDiscovery(db.prisma),
    ),
    prisma: db.prisma,
    bank: s.bank,
    contact: new BillingContact({
      prisma: db.prisma,
      emailFingerprintKey: "product-buyer-test-fingerprint-key-000000",
      protection: billingContactProtection(
        Buffer.alloc(32, 42).toString("base64"),
      ),
      documents: consentDocuments("https://inside.example.test"),
      now: () => new Date("2030-01-31T10:00:00Z"),
      sendCode: () => Promise.resolve(),
    }),
    grants: s.grants,
    clock: () => new Date("2030-01-31T10:00:00Z"),
  });
  s.setStatus("CONFIRMED");
  expect(await released.reconcile(ref)).toMatchObject({ ok: true });
  expect(value(await released.recover()).applied).toBeGreaterThan(0);
  expect(s.initCalls()).toBe(1);
  expect(value(await released.status(s.buyer, ref))).toMatchObject({
    access: "ready",
  });
  const acceptance = JSON.stringify(
    (await db.prisma.billingPurchase.findUniqueOrThrow({ where: { id: ref } }))
      .acceptance,
  );
  expect(acceptance).toContain(earlier.digest);
  expect(acceptance).not.toContain("/legal/purchase/v7");
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
    const { purchase, historicalPayments } = await historicalOneTime(
      s,
      snapshot,
    );
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

test.each(["initial", "renewal", "upgrade", "other_terminal", "no_terminal"])(
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
        kind:
          kind === "other_terminal" || kind === "no_terminal"
            ? "renewal"
            : kind,
        state: "prepared",
        lifecycleActive: false,
        environment: retired.config.environment,
        terminalRef:
          kind === "other_terminal"
            ? "HISTORICAL_TERMINAL"
            : retired.config.terminalKey,
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
    const recovery =
      kind === "no_terminal"
        ? new BillingPayments({
            prisma: db.prisma,
            bank: undefined,
            contact: retired.contact,
            grants: retired.grants,
            clock: () => instant,
          })
        : retired.payments;
    const first = value(await recovery.recover());
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
    expect(await recovery.recover()).toMatchObject({ ok: true });
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

async function historicalOneTime(
  s: Awaited<ReturnType<typeof scenario>>,
  snapshot: Prisma.InputJsonValue,
) {
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
        throw new Error("Historical recovery cannot send a new Init or charge");
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
  return { purchase, historicalPayments };
}

test.each(["support", "community"])(
  "historical %s-only coverage does not invent Product content rights and receives durable manual review",
  async (benefit) => {
    const s = await scenario();
    const {
      product: _product,
      supportMonths: _supportMonths,
      ...legacy
    } = s.quote.snapshot;
    const snapshot = {
      ...legacy,
      offer: {
        ...legacy.offer,
        benefits: [benefit],
        coverage: { productIds: [s.productId], materialIds: [] },
      },
    };
    const { purchase, historicalPayments } = await historicalOneTime(
      s,
      snapshot,
    );
    expect(
      await historicalPayments.reconcile(purchase.purchaseRef),
    ).toMatchObject({ ok: true });
    await historicalPayments.recover();
    expect(
      await s.grants.readProductAccess(owner, {
        accountId: s.buyer,
        productId: s.productId,
      }),
    ).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(
      await historicalPayments.status(s.buyer, purchase.purchaseRef),
    ).toMatchObject({ ok: true, value: { access: "review_required" } });
    const outbox = await db.prisma.billingFulfillment.findFirstOrThrow({
      where: { purchaseRef: purchase.purchaseRef },
    });
    await historicalPayments.recover();
    expect(
      await db.prisma.billingFulfillment.findFirstOrThrow({
        where: { purchaseRef: purchase.purchaseRef },
      }),
    ).toEqual(outbox);
    expect(
      await db.prisma.billingPaymentEvent.count({
        where: {
          purchaseRef: purchase.purchaseRef,
          kind: "fulfillment_review_required",
        },
      }),
    ).toBe(1);
  },
);

test.each(["confirmed_first", "partial_first"] as const)(
  "a verified partial refund (%s) is retained once with unresolved amount and never revokes Product rights",
  async (order) => {
    const fixture = createProductCommerceFixture(db, owner);
    const s = await fixture.scenario();
    const purchase = value(await s.payments.purchase(s.buyer, s.command));
    if (order === "confirmed_first") {
      await s.notify("CONFIRMED");
      await s.payments.recover();
    }
    expect(
      await s.notify("PARTIAL_REFUNDED", { PaymentId: "foreign-payment" }),
    ).toMatchObject({ ok: false, error: { code: "invalid_notification" } });
    expect(
      await s.notify("PARTIAL_REFUNDED", { Success: false }),
    ).toMatchObject({ ok: false, error: { code: "invalid_notification" } });
    expect(await s.notify("PARTIAL_REFUNDED")).toMatchObject({ ok: true });
    expect(await s.notify("PARTIAL_REFUNDED")).toMatchObject({ ok: true });
    expect(
      await s.payments.status(s.buyer, purchase.purchaseRef),
    ).toMatchObject({
      ok: true,
      value: {
        refundedKopecks: null,
        ...(order === "partial_first"
          ? { state: "unknown", access: "awaiting_payment" }
          : { access: "ready" }),
      },
    });
    const observed = await db.prisma.billingPurchase.findUniqueOrThrow({
      where: { id: purchase.purchaseRef },
    });
    fixture.setTime(new Date("2030-02-01T10:00:00Z"));
    await s.payments.recover();
    expect(
      await db.prisma.billingPurchase.findUniqueOrThrow({
        where: { id: purchase.purchaseRef },
      }),
    ).toEqual(observed);
    expect(
      await db.prisma.billingPaymentEvent.count({
        where: {
          purchaseRef: purchase.purchaseRef,
          kind: { startsWith: "partial_refund_observed:" },
        },
      }),
    ).toBe(1);
    expect(
      await db.prisma.billingRefund.count({
        where: { purchaseRef: purchase.purchaseRef },
      }),
    ).toBe(0);
    // A later exact full-capture proof permits fulfillment independently of unresolved refund amount.
    await s.notify("CONFIRMED");
    await s.payments.recover();
    expect(
      await s.payments.status(s.buyer, purchase.purchaseRef),
    ).toMatchObject({
      ok: true,
      value: { access: "ready", refundedKopecks: null },
    });
    await s.notify("REFUNDED");
    // A late distinct partial observation cannot erase an already proven full refund amount.
    await s.notify("PARTIAL_REFUNDED", { Amount: 50000 });
    expect(
      await s.payments.status(s.buyer, purchase.purchaseRef),
    ).toMatchObject({
      ok: true,
      value: { access: "ready", refundedKopecks: 200000 },
    });
    expect(s.initCalls()).toBe(1);
  },
);
test("a committed manual Product issuance between the initial rights read and purchase admission prevents Init", async () => {
  const s = await scenario();
  let firstRead = true;
  const racing = new BillingPayments({
    prisma: db.prisma,
    bank: s.bank,
    contact: s.contact,
    contentCatalog: new CoverageCatalog(
      db.prisma,
      new ProductDiscovery(db.prisma),
    ),
    clock: () => new Date("2030-01-31T10:00:00Z"),
    grants: {
      ...s.grants,
      resolveCapabilities: async (
        ...args: Parameters<typeof s.grants.resolveCapabilities>
      ) => {
        const result = await s.grants.resolveCapabilities(...args);
        if (firstRead) {
          firstRead = false;
          expect(
            await s.grants.issueManualProductAccess(owner, {
              accountId: s.buyer,
              productId: s.productId,
              sourceRef: randomUUID(),
              reason: "Concurrent real owner issuance",
            }),
          ).toMatchObject({ ok: true });
        }
        return result;
      },
    },
  });
  expect(await racing.purchase(s.buyer, s.command)).toMatchObject({
    ok: false,
    error: { code: "existing_access" },
  });
  expect(s.initCalls()).toBe(0);
  expect(
    await db.prisma.billingPurchase.count({ where: { accountId: s.buyer } }),
  ).toBe(0);
});

test("historical mixed Product capability and non-content coverage grants only the saved content Product", async () => {
  const s = await scenario();
  const other = await scenario();
  const {
    product: _product,
    supportMonths: _supportMonths,
    ...legacy
  } = s.quote.snapshot;
  const snapshot = {
    ...legacy,
    offer: {
      ...legacy.offer,
      benefits: [`product:${s.productId}`, "support"],
      coverage: { productIds: [other.productId], materialIds: [] },
    },
  };
  const { purchase, historicalPayments } = await historicalOneTime(s, snapshot);
  expect(
    await historicalPayments.reconcile(purchase.purchaseRef),
  ).toMatchObject({ ok: true });
  expect(value(await historicalPayments.recover()).applied).toBe(1);
  expect(
    await s.grants.readProductAccess(owner, {
      accountId: s.buyer,
      productId: s.productId,
    }),
  ).toMatchObject({ ok: true, value: { access: "active" } });
  expect(
    await s.grants.readProductAccess(owner, {
      accountId: s.buyer,
      productId: other.productId,
    }),
  ).toMatchObject({ ok: false, error: { code: "not_found" } });
});

test("a crash after historical Product issuance preserves an owner revoke when pending fulfillment replays", async () => {
  const s = await scenario();
  const other = await scenario();
  const {
    product: _product,
    supportMonths: _supportMonths,
    ...legacy
  } = s.quote.snapshot;
  const snapshot = {
    ...legacy,
    offer: {
      ...legacy.offer,
      benefits: [`product:${s.productId}`, `product:${other.productId}`],
      coverage: { productIds: [], materialIds: [] },
    },
  };
  const { purchase, historicalPayments } = await historicalOneTime(s, snapshot);
  expect(
    await historicalPayments.reconcile(purchase.purchaseRef),
  ).toMatchObject({ ok: true });
  const confirmedAt = (
    await db.prisma.billingPurchase.findUniqueOrThrow({
      where: { id: purchase.purchaseRef },
    })
  ).confirmedAt;
  if (confirmedAt === null) throw new Error("Capture time missing");
  // Same owning source as the first write before a process crash, outbox still pending.
  expect(
    await s.grants.issueProductAccess(
      { source: "purchase" },
      {
        accountId: s.buyer,
        productId: s.productId,
        sourceRef: `payment:${purchase.purchaseRef}:product:${s.productId}`,
        issuedAt: confirmedAt.toISOString(),
        reason: "payment_confirmed",
      },
    ),
  ).toMatchObject({ ok: true });
  const prior = value(
    await s.grants.readProductAccess(owner, {
      accountId: s.buyer,
      productId: s.productId,
    }),
  );
  expect(
    await s.grants.revokeProductAccess(owner, {
      accountId: s.buyer,
      productId: s.productId,
      operationId: randomUUID(),
      expectedRevision: prior.revision,
      reason: "Owner revocation while fulfillment is pending",
    }),
  ).toMatchObject({ ok: true });
  expect(value(await historicalPayments.recover()).applied).toBe(1);
  expect(
    await s.grants.readProductAccess(owner, {
      accountId: s.buyer,
      productId: s.productId,
    }),
  ).toMatchObject({ ok: true, value: { access: "revoked" } });
  expect(
    await s.grants.readProductAccess(owner, {
      accountId: s.buyer,
      productId: other.productId,
    }),
  ).toMatchObject({ ok: true, value: { access: "active" } });
  expect(
    await db.prisma.productAccessSource.count({
      where: { accountId: s.buyer, source: "purchase" },
    }),
  ).toBe(2);
});

test("partial Amount is preserved as an observation without weakening full capture proof or binding an unknown PaymentId", async () => {
  const s = await scenario();
  s.loseInit();
  const lost = await s.payments.purchase(s.buyer, s.command);
  expect(lost).toMatchObject({ ok: true, value: { state: "unknown" } });
  const purchase = await db.prisma.billingPurchase.findFirstOrThrow({
    where: { accountId: s.buyer },
  });
  expect(purchase.paymentId).toBeNull();
  expect(await s.notify("PARTIAL_REFUNDED", { Amount: 50000 })).toMatchObject({
    ok: true,
  });
  const observed = await db.prisma.billingPurchase.findUniqueOrThrow({
    where: { id: purchase.id },
  });
  expect(observed.paymentId).toBeNull();
  expect(observed.refundReviewRequired).toBe(true);
  expect(await s.notify("CONFIRMED", { Amount: 50000 })).toMatchObject({
    ok: false,
    error: { code: "invalid_notification" },
  });
  expect(await s.notify("REFUNDED", { Amount: 50000 })).toMatchObject({
    ok: false,
    error: { code: "invalid_notification" },
  });
  expect(
    await db.prisma.billingFulfillment.count({
      where: { purchaseRef: purchase.id },
    }),
  ).toBe(0);
  expect(await s.notify("CONFIRMED")).toMatchObject({ ok: true });
  await s.payments.recover();
  expect(await s.payments.status(s.buyer, purchase.id)).toMatchObject({
    ok: true,
    value: { access: "ready", refundedKopecks: null },
  });
  expect(s.initCalls()).toBe(1);
});

test("a fresh Product purchase continues an unknown historical materials purchase with explicit Product scope without another Init", async () => {
  const s = await scenario();
  const {
    product: _product,
    supportMonths: _supportMonths,
    ...legacy
  } = s.quote.snapshot;
  const snapshot = {
    ...legacy,
    offer: {
      ...legacy.offer,
      benefits: ["materials"],
      coverage: { productIds: [s.productId], materialIds: [] },
    },
  };
  const { purchase } = await historicalOneTime(s, snapshot);
  // Current fake bank disagrees with the saved provider id, but must never be asked for fresh Init.
  await s.payments.purchase(s.buyer, s.command);
  expect(s.initCalls()).toBe(0);
  expect(
    await db.prisma.billingPurchase.count({ where: { accountId: s.buyer } }),
  ).toBe(1);
  expect(
    await s.payments.restoreProductPurchase(
      s.buyer,
      s.productId,
      purchase.purchaseRef,
    ),
  ).toMatchObject({ ok: true, value: { purchaseRef: purchase.purchaseRef } });
});

test.each(["manual", "purchase"] as const)(
  "a previously acquired then revoked Product (%s) cannot be sold again",
  async (source) => {
    const s = await scenario();
    if (source === "manual") {
      expect(
        await s.grants.issueManualProductAccess(owner, {
          accountId: s.buyer,
          productId: s.productId,
          sourceRef: randomUUID(),
          reason: "Owner Product acquisition",
        }),
      ).toMatchObject({ ok: true });
    } else {
      expect(await s.payments.purchase(s.buyer, s.command)).toMatchObject({
        ok: true,
      });
      await s.notify("CONFIRMED");
      await s.payments.recover();
    }
    const pair = { accountId: s.buyer, productId: s.productId };
    const prior = value(await s.grants.readProductAccess(owner, pair));
    expect(
      await s.grants.revokeProductAccess(owner, {
        ...pair,
        operationId: randomUUID(),
        expectedRevision: prior.revision,
        reason: "Owner withdrawal must not enable a second sale",
      }),
    ).toMatchObject({ ok: true });
    const initBefore = s.initCalls();
    expect(
      await s.payments.purchase(s.buyer, {
        ...s.command,
        operationId: randomUUID(),
      }),
    ).toMatchObject({ ok: false, error: { code: "existing_access" } });
    expect(s.initCalls()).toBe(initBefore);
  },
);

test.each(["sequential", "concurrent", "existing_event"] as const)(
  "multiple historical fulfillment rows (%s) share one immutable review event without starving a valid purchase",
  async (mode) => {
    const s = await scenario();
    const {
      product: _product,
      supportMonths: _supportMonths,
      ...legacy
    } = s.quote.snapshot;
    const snapshot = {
      ...legacy,
      offer: {
        ...legacy.offer,
        benefits: ["support", "community"],
        coverage: { productIds: [s.productId], materialIds: [] },
      },
    };
    const { purchase, historicalPayments } = await historicalOneTime(
      s,
      snapshot,
    );
    expect(
      await historicalPayments.reconcile(purchase.purchaseRef),
    ).toMatchObject({ ok: true });
    const first = await db.prisma.billingFulfillment.findFirstOrThrow({
      where: { purchaseRef: purchase.purchaseRef },
    });
    let priorEvent;
    if (mode === "existing_event") {
      expect(await historicalPayments.recover()).toMatchObject({ ok: true });
      priorEvent = await db.prisma.billingPaymentEvent.findUniqueOrThrow({
        where: {
          purchaseRef_kind: {
            purchaseRef: purchase.purchaseRef,
            kind: "fulfillment_review_required",
          },
        },
      });
    }
    // Reconstruct another pre-refactoring per-benefit outbox item without changing saved purchase facts.
    const eventRef = randomUUID();
    const payload = {
      eventRef,
      periodRef: `${purchase.purchaseRef}:community`,
      accountId: s.buyer,
      revision: 1,
      revoked: false,
      terms: {
        capabilities: ["community"],
        coverage: snapshot.offer.coverage,
        startsAt: "2030-01-31T10:00:00.000Z",
        validUntil: null,
        reason: `Confirmed payment ${purchase.purchaseRef}`,
      },
    };
    await db.prisma.billingFulfillment.create({
      data: {
        eventRef,
        purchaseRef: purchase.purchaseRef,
        payload,
        nextAttemptAt: new Date("2000-01-01"),
      },
    });
    const valid = await scenario();
    const validRef = value(
      await valid.payments.purchase(valid.buyer, valid.command),
    ).purchaseRef;
    expect(await valid.notify("CONFIRMED")).toMatchObject({ ok: true });
    const runs = await Promise.all(
      Array.from({ length: mode === "concurrent" ? 2 : 1 }, () =>
        historicalPayments.recover(),
      ),
    );
    expect(runs.every((result) => result.ok)).toBe(true);
    const rows = await db.prisma.billingFulfillment.findMany({
      where: { purchaseRef: purchase.purchaseRef },
      orderBy: { eventRef: "asc" },
    });
    expect(rows).toHaveLength(2);
    expect(
      rows.every(
        (row) =>
          row.appliedAt === null &&
          row.reviewRequiredAt !== null &&
          row.reviewReason === "historical_scope_unresolved",
      ),
    ).toBe(true);
    expect(
      rows.find((row) => row.eventRef === first.eventRef)?.payload,
    ).toEqual(first.payload);
    expect(rows.find((row) => row.eventRef === eventRef)?.payload).toEqual(
      payload,
    );
    const events = await db.prisma.billingPaymentEvent.findMany({
      where: {
        purchaseRef: purchase.purchaseRef,
        kind: "fulfillment_review_required",
      },
    });
    expect(events).toHaveLength(1);
    if (priorEvent !== undefined) expect(events[0]).toEqual(priorEvent);
    await historicalPayments.recover();
    expect(
      await db.prisma.billingFulfillment.findMany({
        where: { purchaseRef: purchase.purchaseRef },
        orderBy: { eventRef: "asc" },
      }),
    ).toEqual(rows);
    expect(
      await s.grants.readProductAccess(owner, {
        accountId: s.buyer,
        productId: s.productId,
      }),
    ).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(await valid.payments.status(valid.buyer, validRef)).toMatchObject({
      ok: true,
      value: { access: "ready" },
    });
    expect(s.initCalls()).toBe(0);
  },
);
