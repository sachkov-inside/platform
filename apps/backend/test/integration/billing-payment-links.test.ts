import { randomUUID } from "node:crypto";
import { productCapability } from "@inside/access-capabilities";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { assembleAccounts } from "../../src/modules/accounts/index.js";
import type { BillingPricing } from "../../src/modules/billing/index.js";
import { assembleTestBillingPricing } from "./setup/billing-pricing.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

function value<T>(
  result: { ok: true; value: T } | { ok: false; error: { code: string } },
): T {
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}

function required<T>(item: T | undefined): T {
  if (item === undefined) throw new Error("Missing test entry");
  return item;
}

describe("individual paid links through billing capability on PostgreSQL", () => {
  let db: TestDatabase;
  let pricing: BillingPricing;
  const owner = randomUUID();
  const buyer = randomUUID();
  let now = new Date("2026-10-15T10:00:00Z");
  beforeAll(async () => {
    db = await createMigratedTestDatabase();
    for (const id of [owner, buyer])
      await db.prisma.account.create({
        data: { id, logtoIssuer: "https://identity.invalid", logtoSubject: id },
      });
    await db.prisma.accountPermission.create({
      data: { accountId: owner, permission: "platform:admin" },
    });
    const accounts = assembleAccounts({
      prisma: db.prisma,
      emailFingerprintKey: "individual-links-test-key-00000000000",
    });
    pricing = assembleTestBillingPricing({
      prisma: db.prisma,
      accounts,
      clock: () => now,
      sale: {
        payments: true,
        subscriptions: false,
        amountLimits: { minimumKopecks: 100, maximumKopecks: 100_000_000 },
      },
    });
  });
  afterAll(async () => {
    await db.dispose();
  });
  async function productOption(support = true) {
    const productId = randomUUID(),
      offerId = randomUUID(),
      optionId = randomUUID();
    value(
      await pricing.manage(owner, {
        operation: "offers.save",
        operationId: randomUUID(),
        value: {
          id: offerId,
          name: "AI Engineering",
          benefits: [
            productCapability(productId),
            ...(support ? ["support"] : []),
          ],
          benefitPeriods: [
            { capability: productCapability(productId), months: null },
            ...(support ? [{ capability: "support", months: 6 }] : []),
          ],
          coverage: { productIds: [productId], materialIds: [] },
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
          months: 6,
          priceKopecks: 2_900_000,
        },
      }),
    );
    return { productId, offerId, optionId };
  }
  test("owner issues a 10% link while public sales stay closed; quote is 26,100 RUB and catalog remains 29,000 RUB", async () => {
    const { optionId } = await productOption();
    const link = value(
      await pricing.managePaymentLink(owner, {
        operation: "paymentLinks.create",
        operationId: randomUUID(),
        paymentOptionId: optionId,
        optionRevision: 1,
        price: { kind: "discount", percent: 10 },
        expiresAt: null,
      }),
    );
    expect(link.state).toBe("active");
    expect(link.snapshot.firstPriceKopecks).toBe(2_610_000);
    const quote = value(
      await pricing.quote(buyer, {
        operationId: randomUUID(),
        paymentOptionId: optionId,
        optionRevision: 1,
        paymentLinkId: link.id,
      }),
    );
    expect(quote.snapshot.firstPriceKopecks).toBe(2_610_000);
    expect(value(await pricing.offers({})).items).toHaveLength(0);
    expect(
      value(await pricing.ownerCatalog({})).items.find(
        (x) => x.paymentOption.id === optionId,
      )?.firstPriceKopecks,
    ).toBe(2_900_000);
  });
  test("two buyers cannot reserve one link twice; unknown retains it and definitive failure permits retry", async () => {
    const { optionId } = await productOption();
    const otherBuyer = randomUUID();
    await db.prisma.account.create({
      data: {
        id: otherBuyer,
        logtoIssuer: "https://identity.invalid",
        logtoSubject: otherBuyer,
      },
    });
    const link = value(
      await pricing.managePaymentLink(owner, {
        operation: "paymentLinks.create",
        operationId: randomUUID(),
        paymentOptionId: optionId,
        optionRevision: 1,
        price: { kind: "amount", amountKopecks: 2_610_000 },
        expiresAt: null,
      }),
    );
    const accounts = [buyer, otherBuyer];
    const quotes = await Promise.all(
      accounts.map(async (accountId) =>
        value(
          await pricing.quote(accountId, {
            operationId: randomUUID(),
            paymentOptionId: optionId,
            optionRevision: 1,
            paymentLinkId: link.id,
          }),
        ),
      ),
    );
    const refs = [randomUUID(), randomUUID()];
    const reservations = await Promise.all(
      accounts.map((accountId, index) =>
        pricing.reserve({
          accountId,
          purchaseRef: required(refs[index]),
          quoteRef: required(quotes[index]).quoteRef,
          amountLimits: { minimumKopecks: 100, maximumKopecks: 100_000_000 },
        }),
      ),
    );
    expect(reservations.filter((result) => result.ok)).toHaveLength(1);
    expect(reservations.filter((result) => !result.ok)).toEqual([
      { ok: false, error: { code: "reservation_conflict" } },
    ]);
    const winner = reservations.findIndex((result) => result.ok);
    const accountId = required(accounts[winner]),
      purchaseRef = required(refs[winner]);
    value(await pricing.settle({ accountId, purchaseRef, state: "sent" }));
    value(await pricing.settle({ accountId, purchaseRef, state: "unknown" }));
    expect(value(await pricing.paymentLink(link.id)).state).toBe("unknown");
    expect(
      await pricing.managePaymentLink(owner, {
        operation: "paymentLinks.revoke",
        operationId: randomUUID(),
        id: link.id,
        expectedRevision: 1,
      }),
    ).toEqual({ ok: false, error: { code: "reservation_conflict" } });
    value(await pricing.settle({ accountId, purchaseRef, state: "failed" }));
    const retry = value(
      await pricing.quote(otherBuyer, {
        operationId: randomUUID(),
        paymentOptionId: optionId,
        optionRevision: 1,
        paymentLinkId: link.id,
      }),
    );
    const retryRef = randomUUID();
    value(
      await pricing.reserve({
        accountId: otherBuyer,
        purchaseRef: retryRef,
        quoteRef: retry.quoteRef,
        amountLimits: { minimumKopecks: 100, maximumKopecks: 100_000_000 },
      }),
    );
    value(
      await pricing.settle({
        accountId: otherBuyer,
        purchaseRef: retryRef,
        state: "sent",
      }),
    );
    value(
      await pricing.settle({
        accountId: otherBuyer,
        purchaseRef: retryRef,
        state: "confirmed",
      }),
    );
    expect(value(await pricing.paymentLink(link.id)).state).toBe("paid");
    expect(
      await pricing.quote(buyer, {
        operationId: randomUUID(),
        paymentOptionId: optionId,
        optionRevision: 1,
        paymentLinkId: link.id,
      }),
    ).toEqual({ ok: false, error: { code: "reservation_conflict" } });
  });

  test("owner can recover and revoke an issued link; a previously saved quote cannot bypass revocation", async () => {
    const { optionId } = await productOption();
    const command = {
      operation: "paymentLinks.create",
      operationId: randomUUID(),
      paymentOptionId: optionId,
      optionRevision: 1,
      price: { kind: "amount", amountKopecks: 1_500_000 },
      expiresAt: null,
    };
    const link = value(await pricing.managePaymentLink(owner, command));
    expect(value(await pricing.managePaymentLink(owner, command)).id).toBe(
      link.id,
    );
    expect(
      await pricing.managePaymentLink(buyer, {
        ...command,
        operationId: randomUUID(),
      }),
    ).toEqual({ ok: false, error: { code: "forbidden" } });
    const listed = value(await pricing.paymentLinks(owner, {}));
    expect(listed.items.some((item) => item.id === link.id)).toBe(true);
    expect(await pricing.paymentLinks(buyer, {})).toEqual({
      ok: false,
      error: { code: "forbidden" },
    });
    const quote = value(
      await pricing.quote(buyer, {
        operationId: randomUUID(),
        paymentOptionId: optionId,
        optionRevision: 1,
        paymentLinkId: link.id,
      }),
    );
    expect(
      value(
        await pricing.managePaymentLink(owner, {
          operation: "paymentLinks.revoke",
          operationId: randomUUID(),
          id: link.id,
          expectedRevision: 1,
        }),
      ).state,
    ).toBe("revoked");
    expect(
      await pricing.reserve({
        accountId: buyer,
        purchaseRef: randomUUID(),
        quoteRef: quote.quoteRef,
        amountLimits: { minimumKopecks: 100, maximumKopecks: 100_000_000 },
      }),
    ).toEqual({ ok: false, error: { code: "not_found" } });
  });
  test("materials-only link keeps no invented chat or support; expiry and minimum are enforced", async () => {
    const { optionId } = await productOption(false);
    const input = {
      operation: "paymentLinks.create",
      operationId: randomUUID(),
      paymentOptionId: optionId,
      optionRevision: 1,
      price: { kind: "amount", amountKopecks: 100 },
      expiresAt: "2026-10-15T10:01:00Z",
    };
    const link = value(await pricing.managePaymentLink(owner, input));
    expect(link.snapshot.offer.benefits).toHaveLength(1);
    expect(
      await pricing.managePaymentLink(owner, {
        ...input,
        operationId: randomUUID(),
        price: { kind: "amount", amountKopecks: 0 },
      }),
    ).toEqual({ ok: false, error: { code: "invalid_request" } });
    expect(
      await pricing.managePaymentLink(owner, {
        ...input,
        operationId: randomUUID(),
        price: { kind: "discount", percent: 100 },
      }),
    ).toEqual({ ok: false, error: { code: "invalid_request" } });
    now = new Date("2026-10-15T10:02:00Z");
    expect(value(await pricing.paymentLink(link.id)).state).toBe("expired");
    expect(
      await pricing.quote(buyer, {
        operationId: randomUUID(),
        paymentOptionId: optionId,
        optionRevision: 1,
        paymentLinkId: link.id,
      }),
    ).toEqual({ ok: false, error: { code: "not_found" } });
  });
});
