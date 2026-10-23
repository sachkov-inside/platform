import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { pressedPaymentButton } from "./setup/consent-documents.js";
import {
  createProductCommerceWorld,
  commerceValue as value,
} from "./setup/product-commerce.js";
import { revokeProductFixture } from "./setup/product-access.js";
let world: Awaited<ReturnType<typeof createProductCommerceWorld>>;
beforeAll(async () => {
  world = await createProductCommerceWorld();
});
afterAll(async () => world.dispose());

test("a buyer restores its unfinished Product payment from another device without another bank operation", async () => {
  const s = await world.scenario();
  const first = value(await s.payments.purchase(s.buyer, s.command));
  expect(
    await s.payments.restoreProductPurchase(s.buyer, {
      productId: s.productId,
    }),
  ).toMatchObject({ ok: true, value: { purchaseRef: first.purchaseRef } });
  expect(
    await s.payments.restoreProductPurchase(s.buyer, {
      productId: randomUUID(),
      purchaseRef: first.purchaseRef,
    }),
  ).toMatchObject({ ok: false, error: { code: "not_found" } });
  expect(s.initCalls()).toBe(1);
});

test("Order Email is available without a verified contact and remains bound to the original order", async () => {
  const s = await world.scenario();
  const purchase = value(await s.payments.purchase(s.buyer, s.command));
  expect(
    await s.payments.purchaseEmail(s.buyer, purchase.purchaseRef),
  ).toMatchObject({ ok: true, value: "order@example.test" });
  await s.notify("CONFIRMED");
  await s.payments.recover();
  expect(
    value(await s.payments.status(s.buyer, purchase.purchaseRef)),
  ).toMatchObject({ access: "ready", periodEndsAt: null });
  expect(
    await s.payments.purchaseEmail(s.buyer, purchase.purchaseRef),
  ).toMatchObject({ ok: true, value: "order@example.test" });
});

test("replayed purchase survives quote expiry and returns the same payment", async () => {
  const s = await world.scenario();
  const first = value(await s.payments.purchase(s.buyer, s.command));
  world.setTime(new Date("2030-02-01T10:00:00Z"));
  expect(value(await s.payments.purchase(s.buyer, s.command)).purchaseRef).toBe(
    first.purchaseRef,
  );
  expect(s.initCalls()).toBe(1);
  world.setTime(new Date("2030-01-31T10:00:00Z"));
});

test("a Product holder cannot create a new purchase to extend lifetime access", async () => {
  const s = await world.scenario();
  await s.payments.purchase(s.buyer, s.command);
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
    }),
  ).toMatchObject({ ok: false, error: { code: "existing_access" } });
  expect(s.initCalls()).toBe(1);
});

test("a refund preserves access and explicit owner withdrawal survives bank replay", async () => {
  const s = await world.scenario();
  const purchase = value(await s.payments.purchase(s.buyer, s.command));
  await s.notify("CONFIRMED");
  await s.payments.recover();
  await s.notify("REFUNDED");
  expect(
    value(await s.payments.status(s.buyer, purchase.purchaseRef)),
  ).toMatchObject({ access: "ready", refundedKopecks: 200000 });
  await revokeProductFixture(world.db.prisma, `${s.buyer}:${s.productId}`);
  await s.notify("CONFIRMED");
  await s.payments.recover();
  expect(
    await s.grants.readProductAccess(world.owner, {
      accountId: s.buyer,
      productId: s.productId,
    }),
  ).toMatchObject({ ok: true, value: { access: "revoked" } });
});

test("strict purchase admission requires the quote's terms and rejects a browser-supplied consent identity", async () => {
  const s = await world.scenario();
  expect(
    await s.payments.purchase(s.buyer, {
      ...s.command,
      consentEvidenceRefs: [randomUUID()],
    }),
  ).toMatchObject({ ok: false, error: { code: "consent_required" } });
  expect(
    await s.payments.purchase(s.buyer, { ...s.command, accepted: true }),
  ).toMatchObject({ ok: false, error: { code: "invalid_request" } });
  expect(s.initCalls()).toBe(0);
});
