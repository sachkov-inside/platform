import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { z } from "zod";
import {
  assembleAccounts,
  BillingContact,
} from "../../src/modules/accounts/index.js";
import { billingContactProtection } from "../../src/modules/accounts/infrastructure/billing-contact-protection.js";
import { assembleAccessGrants } from "../../src/modules/account-rights/index.js";
import {
  BillingPayments,
  BillingPricing,
} from "../../src/modules/billing/index.js";
import {
  Tbank,
  tbankToken,
} from "../../src/modules/billing/infrastructure/tbank/tbank.js";
import { syntheticTbankConfig } from "../support/bank-terminal.js";
import {
  syntheticConsentDocument,
  pressedPaymentButton,
} from "./setup/consent-documents.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";
let db: TestDatabase;
const owner = randomUUID();
let now = new Date("2030-01-31T10:00:00Z");
const config = syntheticTbankConfig({
  environment: "demo",
  terminalKey: "PRODUCTDEMO",
  password: "synthetic-password",
  bindingEncryptionKey: Buffer.alloc(32, 43).toString("base64"),
  recurringCardConfirmed: false,
  cardOnlyHostedConfirmed: false,
  minimumKopecks: 100,
  maximumKopecks: 1_000_000,
  returnUrl: "https://inside.example.test/account",
  notificationUrl: "https://inside.example.test/billing/tbank/notification",
  receipt: { taxation: "usn_income", tax: "none" },
});
function value<T>(
  result: { ok: true; value: T } | { ok: false; error: { code: string } },
): T {
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}
function setupFacets() {
  const accounts = assembleAccounts({
    prisma: db.prisma,
    emailFingerprintKey: "product-buyer-test-fingerprint-key-000000",
  });
  const grants = assembleAccessGrants({
    prisma: db.prisma,
    accounts,
    clock: () => now,
  });
  const pricing = new BillingPricing({
    prisma: db.prisma,
    accounts,
    sale: { payments: true, subscriptions: false },
    clock: () => now,
  });
  const document = syntheticConsentDocument("terms", {
    appliesTo: ["one_time"],
  });
  const contact = new BillingContact({
    prisma: db.prisma,
    protection: billingContactProtection(
      Buffer.alloc(32, 42).toString("base64"),
    ),
    documents: [document],
    now: () => now,
    sendCode: () => Promise.resolve(),
  });
  return { accounts, grants, pricing, document, contact };
}
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
});
afterAll(async () => db.dispose());
async function scenario(
  options: { productId?: string; discount?: number; usageLimit?: number } = {},
) {
  const buyer = randomUUID(),
    productId = options.productId ?? randomUUID();
  await db.prisma.account.create({
    data: {
      id: buyer,
      logtoIssuer: "https://identity.invalid",
      logtoSubject: buyer,
    },
  });
  const facets = setupFacets();
  if (options.productId === undefined)
    value(
      await facets.pricing.manage(owner, {
        operation: "productPrices.save",
        operationId: randomUUID(),
        value: {
          productId,
          name: "Курс",
          priceKopecks: 200000,
          published: true,
        },
      }),
    );
  if (options.discount !== undefined)
    value(
      await facets.pricing.manage(owner, {
        operation: "promotions.save",
        operationId: randomUUID(),
        value: {
          id: randomUUID(),
          name: "Скидка",
          percent: options.discount,
          code: null,
          startsAt: "2020-01-01T00:00:00.000Z",
          endsAt: "2040-01-01T00:00:00.000Z",
          offerIds: [productId],
          paymentOptionIds: [],
          usageLimit: options.usageLimit ?? null,
        },
      }),
    );
  const quote = value(
    await facets.pricing.quote(buyer, {
      operationId: randomUUID(),
      productId,
      priceRevision: 1,
    }),
  );
  const consent = await facets.contact.acceptConsents(
    buyer,
    pressedPaymentButton({
      operationId: randomUUID(),
      contextRef: quote.quoteRef,
      documents: [
        {
          kind: "terms",
          documentId: facets.document.documentId,
          version: facets.document.version,
          digest: facets.document.digest,
          accepted: true,
        },
      ],
    }),
  );
  if (!consent.ok) throw new Error(consent.error.code);
  const command = {
    operationId: randomUUID(),
    quoteRef: quote.quoteRef,
    email: "order@example.test",
    consentEvidenceRefs: consent.evidenceRefs,
  };
  let orderId = "",
    status = "NEW",
    initCalls = 0,
    timeout = false,
    stateCalls = 0;
  const paymentId = String(Math.floor(Math.random() * 1000000000));
  const event = (nextStatus = status, extra = {}) => ({
    TerminalKey: config.terminalKey,
    OrderId: orderId,
    PaymentId: paymentId,
    Amount: quote.snapshot.firstPriceKopecks,
    Status: nextStatus,
    Success: true,
    ErrorCode: "0",
    ...extra,
  });
  const bank = new Tbank(config, async (url, init) => {
    const body = z
      .object({ OrderId: z.string().optional() })
      .loose()
      .parse(JSON.parse(String(init.body)));
    if (String(url).endsWith("/Init")) {
      initCalls++;
      orderId = z.string().parse(body.OrderId);
      expect(body).toMatchObject({ Amount: quote.snapshot.firstPriceKopecks });
      expect(body).not.toHaveProperty("Recurrent");
      if (timeout) throw new Error("Synthetic lost Init answer");
      return Response.json({
        ...event(),
        PaymentURL: "https://securepay.tinkoff.ru/test",
      });
    }
    if (String(url).endsWith("/CheckOrder"))
      return Response.json({
        Success: true,
        ErrorCode: "0",
        TerminalKey: config.terminalKey,
        OrderId: body.OrderId,
        Payments: [
          { PaymentId: paymentId, Status: status, Success: true, ErrorCode: 0 },
        ],
      });
    if (String(url).endsWith("/GetState")) {
      stateCalls++;
      return Response.json(event());
    }
    throw new Error("Recurring or unsupported bank operation");
  });
  const payments = new BillingPayments({
    prisma: db.prisma,
    bank,
    contact: facets.contact,
    grants: facets.grants,
    clock: () => now,
  });
  const notify = (nextStatus: string, extra = {}) => {
    const body = event(nextStatus, extra);
    return payments.notification({
      ...body,
      Token: tbankToken(body, config.password),
    });
  };
  return {
    ...facets,
    buyer,
    productId,
    quote,
    command,
    payments,
    notify,
    initCalls: () => initCalls,
    stateCalls: () => stateCalls,
    loseInit: () => {
      timeout = true;
    },
    setStatus: (next: string) => {
      status = next;
    },
  };
}
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
