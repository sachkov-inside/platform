import { registerFixedClock } from "../support/fixed-clock.js";

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import {
  assembleAccounts,
  BillingContact,
} from "../../src/modules/accounts/index.js";
import { billingContactProtection } from "../../src/modules/accounts/infrastructure/billing-contact-protection.js";
import {
  BillingPricing,
  BillingPayments,
} from "../../src/modules/billing/index.js";
import type { SaleCapability } from "../../src/modules/billing/domain/sale-capability.js";
import { Tbank } from "../../src/modules/billing/infrastructure/tbank/tbank.js";
import { assembleAccessGrants } from "../../src/modules/account-rights/index.js";
import { syntheticTbankConfig } from "../support/bank-terminal.js";
import { seedPurchaseInvitation } from "./setup/purchase-invitation.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

registerFixedClock();

let db: TestDatabase;
const owner = randomUUID();
const optionId = randomUUID();
function value<T>(
  result: { ok: true; value: T } | { ok: false; error: { code: string } },
): T {
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}
function accountsOf() {
  return assembleAccounts({
    prisma: db.prisma,
    emailFingerprintKey: "sale-admission-test-key-0000000000",
  });
}
function pricingWith(sale: SaleCapability) {
  const accounts = accountsOf();
  return new BillingPricing({
    prisma: db.prisma,
    accounts,
    sale,
    grants: assembleAccessGrants({ prisma: db.prisma, accounts }),
  });
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
  const pricing = pricingWith({ payments: true, subscriptions: true });
  const offerId = randomUUID();
  value(
    await pricing.manage(owner, {
      operation: "offers.save",
      operationId: randomUUID(),
      value: {
        id: offerId,
        name: "Course",
        benefits: [`product:${randomUUID()}`, "support"],
        benefitPeriods: [{ capability: "support", months: 6 }],
      },
    }),
  );
  value(
    await pricing.manage(owner, {
      operation: "paymentOptions.save",
      operationId: randomUUID(),
      value: {
        id: optionId,
        offerId,
        mode: "one_time",
        months: 1,
        priceKopecks: 100_000,
      },
    }),
  );
  value(
    await pricing.manage(owner, {
      operation: "offers.publish",
      operationId: randomUUID(),
      expectedRevision: 1,
      id: offerId,
    }),
  );
});
afterAll(async () => db.dispose());

test("an unavailable payment method hides the option and refuses its quote", async () => {
  const pricing = pricingWith({ payments: false, subscriptions: false });
  expect(await pricing.offers({})).toEqual({
    ok: true,
    value: { items: [], nextCursor: null },
  });
  expect(
    await pricing.quote(owner, {
      operationId: randomUUID(),
      paymentOptionId: optionId,
      optionRevision: 1,
    }),
  ).toEqual({ ok: false, error: { code: "method_unavailable" } });
});

test.each([
  [
    "terminal disabled",
    "one_time",
    false,
    false,
    true,
    true,
    1_000_000,
    "method_unavailable",
  ],
  [
    "recurring confirmation missing",
    "subscription",
    true,
    false,
    true,
    true,
    1_000_000,
    "method_unavailable",
  ],
  [
    "invitation missing",
    "subscription",
    true,
    true,
    false,
    true,
    1_000_000,
    "not_eligible",
  ],
  [
    "old recurring payments not reviewed",
    "subscription",
    true,
    true,
    true,
    false,
    1_000_000,
    "legacy_review_required",
  ],
  [
    "one-time amount outside terminal",
    "one_time",
    true,
    true,
    true,
    true,
    99_999,
    "unsupported_amount",
  ],
  [
    "subscription amount outside terminal",
    "subscription",
    true,
    true,
    true,
    true,
    99_999,
    "unsupported_amount",
  ],
] as const)(
  "quote and purchase agree and storefront hides the option: %s",
  async (
    _name,
    mode,
    paymentsEnabled,
    subscriptionsEnabled,
    invited,
    recurringAllowed,
    maximumKopecks,
    rejectedWith,
  ) => {
    const buyer = randomUUID(),
      offerId = randomUUID(),
      paymentOptionId = randomUUID();
    const accounts = accountsOf();
    const grants = assembleAccessGrants({ prisma: db.prisma, accounts });
    await db.prisma.account.create({
      data: {
        id: buyer,
        logtoIssuer: "https://identity.invalid",
        logtoSubject: buyer,
      },
    });
    const configured = pricingWith({ payments: true, subscriptions: true });
    value(
      await configured.manage(owner, {
        operation: "offers.save",
        operationId: randomUUID(),
        value: {
          id: offerId,
          name: "Product variant",
          benefits: [`product:${randomUUID()}`, "support"],
          benefitPeriods: [{ capability: "support", months: 6 }],
        },
      }),
    );
    value(
      await configured.manage(owner, {
        operation: "paymentOptions.save",
        operationId: randomUUID(),
        value: {
          id: paymentOptionId,
          offerId,
          mode,
          months: 1,
          priceKopecks: 100_000,
        },
      }),
    );
    value(
      await configured.manage(owner, {
        operation: "offers.publish",
        operationId: randomUUID(),
        expectedRevision: 1,
        id: offerId,
      }),
    );
    await seedPurchaseInvitation(db.prisma, buyer, offerId);
    const quote = value(
      await configured.quote(buyer, {
        operationId: randomUUID(),
        paymentOptionId,
        optionRevision: 1,
      }),
    );
    if (!invited)
      await db.prisma.invitation.deleteMany({
        where: { claimedAccountId: buyer },
      });
    if (!recurringAllowed) {
      const result = await grants.classifyLegacy(owner, {
        operationId: randomUUID(),
        accountId: buyer,
        expectedRevision: 0,
        classification: "confirmed_legacy",
        sourceRef: buyer,
        reason: "Unreviewed old payments",
        bridgeEnabled: false,
        tributeStopped: false,
      });
      if (!result.ok) throw new Error(result.error.code);
    }
    const sale = {
      payments: paymentsEnabled,
      subscriptions: subscriptionsEnabled,
      amountLimits: { minimumKopecks: 100, maximumKopecks },
    };
    const pricing = pricingWith(sale);
    expect(
      await pricing.quote(buyer, {
        operationId: randomUUID(),
        paymentOptionId,
        optionRevision: 1,
      }),
    ).toEqual({ ok: false, error: { code: rejectedWith } });
    expect(
      value(await pricing.offers({}, buyer)).items.some(
        (item) => item.paymentOption.id === paymentOptionId,
      ),
    ).toBe(false);
    const contact = new BillingContact({
      prisma: db.prisma,
      protection: billingContactProtection(
        Buffer.alloc(32, 42).toString("base64"),
      ),
      documents: [],
      // deterministic-test-allow wall-clock: Date is fixed per case by registerFixedClock; production consumers share this virtual Date.
      now: () => new Date(),
      sendCode: () => Promise.resolve(),
    });
    const bank = paymentsEnabled
      ? new Tbank(
          syntheticTbankConfig({
            environment: "demo",
            terminalKey: "SYNTHETIC",
            password: "synthetic-password",
            bindingEncryptionKey: Buffer.alloc(32, 43).toString("base64"),
            returnUrl: "https://inside.example.test/account",
            notificationUrl:
              "https://inside.example.test/billing/tbank/notification",
            receipt: { taxation: "usn_income", tax: "none" },
            recurringCardConfirmed: subscriptionsEnabled,
            cardOnlyHostedConfirmed: subscriptionsEnabled,
            minimumKopecks: 100,
            maximumKopecks,
          }),
          () => {
            throw new Error("Admission must refuse before a bank request");
          },
        )
      : undefined;
    const payments = new BillingPayments({
      prisma: db.prisma,
      grants,
      contact,
      bank,
    });
    expect(
      await payments.purchase(buyer, {
        operationId: randomUUID(),
        quoteRef: quote.quoteRef,
        contactRevision: 1,
        consentEvidenceRefs: [randomUUID()],
        acknowledgeExistingAccess: false,
      }),
    ).toEqual({ ok: false, error: { code: rejectedWith } });
  },
);
test("product sale uses coverage and payment mode, including an invited subscription to a product", async () => {
  const productId = randomUUID();
  const pricing = pricingWith({ payments: true, subscriptions: true });
  const ids: string[] = [];
  for (const variant of [
    {
      benefits: [`product:${productId}`, "support"],
      benefitPeriods: [{ capability: "support", months: 6 }],
      mode: "subscription",
    },
    {
      benefits: ["materials"],
      coverage: { productIds: [productId], materialIds: [] },
      mode: "one_time",
    },
    {
      benefits: ["materials"],
      coverage: { productIds: [], materialIds: [], wholePlatform: true },
      mode: "subscription",
    },
  ]) {
    const offerId = randomUUID(),
      id = randomUUID();
    const { mode, ...offer } = variant;
    value(
      await pricing.manage(owner, {
        operation: "offers.save",
        operationId: randomUUID(),
        value: { id: offerId, name: "Covered product", ...offer },
      }),
    );
    value(
      await pricing.manage(owner, {
        operation: "paymentOptions.save",
        operationId: randomUUID(),
        value: { id, offerId, mode, months: 1, priceKopecks: 100_000 },
      }),
    );
    value(
      await pricing.manage(owner, {
        operation: "offers.publish",
        operationId: randomUUID(),
        expectedRevision: 1,
        id: offerId,
      }),
    );
    await seedPurchaseInvitation(db.prisma, owner, offerId);
    ids.push(id);
  }
  const visible = value(
    await pricing.offers({ capability: `product:${productId}` }, owner),
  ).items;
  expect(visible.map((item) => item.paymentOption.id).sort()).toEqual(
    [...ids].sort(),
  );
  const guest = value(
    await pricing.offers({ capability: `product:${productId}` }),
  ).items;
  expect(guest.map((item) => item.paymentOption.id)).toEqual([ids[1]]);
  expect(await pricing.hasOffersForSale()).toBe(false);
  expect(await pricing.hasOffersForSale(owner)).toBe(true);
});
