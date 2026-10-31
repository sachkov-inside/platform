import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";

import { pressedPaymentButton } from "./setup/consent-documents.js";
import {
  createProductCommerceWorld,
  commerceValue as value,
} from "./setup/product-commerce.js";

/**
 * Owner decision 3 of #1921 (#1925): a purchase at another price replaces the open unpaid attempt
 * of the same Product. The old attempt retires and its bank form is cancelled through #1923; the
 * same price still continues the open attempt without another Init.
 */
let world: Awaited<ReturnType<typeof createProductCommerceWorld>>;
beforeAll(async () => {
  world = await createProductCommerceWorld();
});
afterAll(async () => world.dispose());

type Scenario = Awaited<ReturnType<typeof world.scenario>>;

const linkPriceKopecks = 150000;

/** The buyer presses "Оплатить" on another page: a new quote, a new consent and a new command. */
async function purchaseCommand(
  s: Scenario,
  pricing: { paymentLinkId?: string; promoCode?: string } = {},
) {
  const quote = value(
    await s.pricing.quote(s.buyer, {
      operationId: randomUUID(),
      productId: s.productId,
      priceRevision: 1,
      ...pricing,
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
  return {
    ...s.command,
    operationId: randomUUID(),
    quoteRef: quote.quoteRef,
    consentEvidenceRefs: consent.evidenceRefs,
  };
}

async function paymentLink(s: Scenario): Promise<string> {
  s.allowInitAmount(linkPriceKopecks);
  const link = value(
    await s.pricing.managePaymentLink(world.owner, {
      operation: "paymentLinks.create",
      operationId: randomUUID(),
      productId: s.productId,
      priceRevision: 1,
      price: { kind: "amount", amountKopecks: linkPriceKopecks },
      expiresAt: null,
    }),
  );
  return link.id;
}

async function purchaseRow(purchaseRef: string) {
  return world.db.prisma.billingPurchase.findUniqueOrThrow({
    where: { id: purchaseRef },
    select: {
      state: true,
      amountKopecks: true,
      paymentId: true,
      paymentUrl: true,
    },
  });
}

async function eventPayloads(purchaseRef: string) {
  const rows = await world.db.prisma.billingPaymentEvent.findMany({
    where: { purchaseRef },
    select: { kind: true, payload: true },
    orderBy: { kind: "asc" },
  });
  return Object.fromEntries(rows.map((row) => [row.kind, row.payload]));
}

test("a Payment Link purchase replaces the open storefront attempt and cancels its bank form", async () => {
  const s = await world.scenario();
  const storefront = value(await s.payments.purchase(s.buyer, s.command));
  const storefrontPaymentId = s.paymentId();
  const linkId = await paymentLink(s);

  const replacement = value(
    await s.payments.purchase(
      s.buyer,
      await purchaseCommand(s, { paymentLinkId: linkId }),
    ),
  );

  expect(replacement.purchaseRef).not.toBe(storefront.purchaseRef);
  expect(replacement).toMatchObject({
    state: "pending",
    snapshot: {
      firstPriceKopecks: linkPriceKopecks,
      individualPayment: { linkId },
    },
  });
  expect(replacement.paymentUrl).not.toBeNull();
  expect(s.initCalls()).toBe(2);
  expect(await purchaseRow(replacement.purchaseRef)).toMatchObject({
    amountKopecks: BigInt(linkPriceKopecks),
  });
  expect(await purchaseRow(storefront.purchaseRef)).toEqual({
    state: "failed",
    amountKopecks: BigInt(200000),
    paymentId: storefrontPaymentId,
    paymentUrl: null,
  });
  expect(await eventPayloads(storefront.purchaseRef)).toEqual({
    bank_cancel_requested: {
      reason: "replaced_by_new_price",
      replacementPurchaseRef: replacement.purchaseRef,
    },
    replaced_by_new_price: { replacementPurchaseRef: replacement.purchaseRef },
  });
  // The buyer's request only reads the bank; the background reconciliation sends Cancel.
  expect(s.cancelRequests()).toEqual([]);

  value(await s.payments.recover());

  expect(s.cancelRequests()).toEqual([
    expect.objectContaining({ PaymentId: storefrontPaymentId }),
  ]);
  expect(await eventPayloads(storefront.purchaseRef)).toMatchObject({
    bank_cancel_confirmed: {
      paymentId: storefrontPaymentId,
      status: "CANCELED",
    },
  });
  expect((await purchaseRow(replacement.purchaseRef)).state).toBe("pending");
});

test("a new storefront quote at the same price continues the open attempt without another Init", async () => {
  const s = await world.scenario();
  const first = value(await s.payments.purchase(s.buyer, s.command));

  const repeated = value(
    await s.payments.purchase(s.buyer, await purchaseCommand(s)),
  );

  expect(repeated.purchaseRef).toBe(first.purchaseRef);
  expect(repeated.paymentUrl).toBe(first.paymentUrl);
  expect(s.initCalls()).toBe(1);
  expect(await eventPayloads(first.purchaseRef)).toEqual({});
});

test("a promo code price replaces the open storefront attempt at the full price", async () => {
  const s = await world.scenario();
  const storefront = value(await s.payments.purchase(s.buyer, s.command));
  value(
    await s.pricing.manage(world.owner, {
      operation: "promotions.save",
      operationId: randomUUID(),
      value: {
        id: randomUUID(),
        name: "Код",
        percent: 10,
        code: "INSIDE10",
        startsAt: "2020-01-01T00:00:00.000Z",
        endsAt: "2040-01-01T00:00:00.000Z",
        productIds: [s.productId],
        usageLimit: null,
      },
    }),
  );
  s.allowInitAmount(180000);

  const promoted = value(
    await s.payments.purchase(
      s.buyer,
      await purchaseCommand(s, { promoCode: "INSIDE10" }),
    ),
  );

  expect(promoted.purchaseRef).not.toBe(storefront.purchaseRef);
  expect(promoted.snapshot.firstPriceKopecks).toBe(180000);
  expect(s.initCalls()).toBe(2);
  expect((await purchaseRow(storefront.purchaseRef)).state).toBe("failed");
  expect(await eventPayloads(storefront.purchaseRef)).toMatchObject({
    replaced_by_new_price: { replacementPurchaseRef: promoted.purchaseRef },
  });
});

test("an open attempt the bank already confirmed is not replaced: the buyer sees its payment status", async () => {
  const s = await world.scenario();
  const storefront = value(await s.payments.purchase(s.buyer, s.command));
  // The buyer paid the storefront form; its notification has not reached Inside yet.
  s.setPaymentStatus(s.paymentId(), "CONFIRMED");
  const linkId = await paymentLink(s);

  const answer = value(
    await s.payments.purchase(
      s.buyer,
      await purchaseCommand(s, { paymentLinkId: linkId }),
    ),
  );

  expect(answer).toMatchObject({
    purchaseRef: storefront.purchaseRef,
    state: "confirmed",
    paymentUrl: null,
  });
  expect(s.initCalls()).toBe(1);
  expect(s.cancelRequests()).toEqual([]);
  expect(
    await world.db.prisma.billingPurchase.count({
      where: { accountId: s.buyer },
    }),
  ).toBe(1);
});

test("an authorized open attempt is not replaced by another price", async () => {
  const s = await world.scenario();
  const storefront = value(await s.payments.purchase(s.buyer, s.command));
  value(await s.notify("AUTHORIZED"));
  const linkId = await paymentLink(s);

  const answer = value(
    await s.payments.purchase(
      s.buyer,
      await purchaseCommand(s, { paymentLinkId: linkId }),
    ),
  );

  expect(answer).toMatchObject({
    purchaseRef: storefront.purchaseRef,
    state: "authorized",
    paymentUrl: null,
  });
  expect(s.initCalls()).toBe(1);
  expect(await eventPayloads(storefront.purchaseRef)).toEqual({});
});

test("a replacement whose new reservation fails leaves the open attempt untouched", async () => {
  const s = await world.scenario();
  const storefront = value(await s.payments.purchase(s.buyer, s.command));
  const linkId = await paymentLink(s);
  const command = await purchaseCommand(s, { paymentLinkId: linkId });
  // Another Account takes the link between the buyer's quote and the purchase.
  const other = await world.scenario({
    productId: s.productId,
    paymentLinkId: linkId,
  });
  value(await other.payments.purchase(other.buyer, other.command));

  const answer = await s.payments.purchase(s.buyer, command);

  expect(answer).toMatchObject({ ok: false });
  expect(s.initCalls()).toBe(1);
  expect(await purchaseRow(storefront.purchaseRef)).toMatchObject({
    state: "pending",
  });
  expect(await eventPayloads(storefront.purchaseRef)).toEqual({});
  expect(
    await world.db.prisma.billingPurchase.count({
      where: { accountId: s.buyer },
    }),
  ).toBe(1);
});

test("an open form the bank cannot check yet is neither replaced nor offered at the old price", async () => {
  const s = await world.scenario();
  const storefront = value(await s.payments.purchase(s.buyer, s.command));
  const linkId = await paymentLink(s);
  const command = await purchaseCommand(s, { paymentLinkId: linkId });
  s.afterState(() => {
    throw new Error("Synthetic unavailable GetState");
  });

  const unavailable = await s.payments.purchase(s.buyer, command);

  expect(unavailable).toEqual({
    ok: false,
    error: { code: "provider_unavailable" },
  });
  expect(s.initCalls()).toBe(1);
  expect((await purchaseRow(storefront.purchaseRef)).state).toBe("pending");
  expect(await eventPayloads(storefront.purchaseRef)).toEqual({});

  // The same command succeeds once the bank answers again.
  s.afterState(undefined);
  const replacement = value(await s.payments.purchase(s.buyer, command));

  expect(replacement.purchaseRef).not.toBe(storefront.purchaseRef);
  expect(replacement.snapshot.firstPriceKopecks).toBe(linkPriceKopecks);
  expect((await purchaseRow(storefront.purchaseRef)).state).toBe("failed");
});
