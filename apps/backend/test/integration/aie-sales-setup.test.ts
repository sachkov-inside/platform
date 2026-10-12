import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { z } from "zod";
import { assembleAccounts } from "../../src/modules/accounts/index.js";
import { assembleAccessGrants } from "../../src/modules/account-rights/index.js";
import { BillingOperations } from "../../src/modules/billing/index.js";
import { manageCatalogSchema } from "../../src/modules/billing/features/manage-catalog/manage-catalog.contract.js";
import type { PricingResult } from "../../src/modules/billing/domain/pricing.js";
import { assembleTestBillingPricing } from "./setup/billing-pricing.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

let database: TestDatabase;
beforeAll(async () => {
  database = await createMigratedTestDatabase();
});
afterAll(async () => database.dispose());

function value<T>(result: PricingResult<T>): T {
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}

async function commands(name: string) {
  const text = await readFile(
    new URL(
      `../../../../docs/evidence/issue-1359/${name}.json`,
      import.meta.url,
    ),
    "utf8",
  );
  const input: unknown = JSON.parse(text);
  return z.array(manageCatalogSchema).parse(input);
}

test("AIE sales commands preserve the sale gate and agreed prices (#1359)", async () => {
  const owner = "13590000-0000-4000-8000-000000000101";
  const buyer = "13590000-0000-4000-8000-000000000102";
  for (const id of [owner, buyer])
    await database.prisma.account.create({
      data: { id, logtoIssuer: "https://identity.invalid", logtoSubject: id },
    });
  await database.prisma.accountPermission.create({
    data: { accountId: owner, permission: "platform:admin" },
  });
  const accounts = assembleAccounts({
    prisma: database.prisma,
    emailFingerprintKey: "aie-rehearsal-key-00000000000000000000",
  });
  let now = new Date("2026-10-12T18:00:00Z");
  const clock = () => now;
  const billing = assembleTestBillingPricing({
    prisma: database.prisma,
    accounts,
    clock,
    sale: { payments: true, subscriptions: false },
  });
  const operations = new BillingOperations({
    prisma: database.prisma,
    accounts,
    pricing: billing,
    grants: assembleAccessGrants({ prisma: database.prisma, accounts, clock }),
    payments: { reconcile: () => Promise.reject(new Error("unused")) },
    subscriptions: { cancel: () => Promise.reject(new Error("unused")) },
    bank: undefined,
    clock,
  });
  for (const command of await commands("prepare"))
    value(await billing.manage(owner, command));
  expect(value(await billing.offers({})).items).toEqual([]);
  const catalog = value(await billing.ownerCatalog({}));
  expect(catalog.items).toHaveLength(1);
  expect(catalog.items[0]).toMatchObject({
    offer: { published: false },
    paymentOption: { mode: "one_time" },
    firstPriceKopecks: 2_990_000,
    promotion: null,
  });
  const quoteInput = {
    paymentOptionId: "13590000-0000-4000-8000-000000000002",
    optionRevision: 1,
  };
  expect(
    await billing.quote(buyer, { ...quoteInput, operationId: randomUUID() }),
  ).toMatchObject({ ok: false, error: { code: "not_found" } });
  for (const command of await commands("open-after-go"))
    value(await billing.manage(owner, command));
  expect(value(await billing.offers({})).items).toHaveLength(1);
  const quote = value(
    await billing.quote(buyer, {
      ...quoteInput,
      operationId: "13590000-0000-4000-8000-000000000201",
    }),
  );
  expect(quote.snapshot).toMatchObject({
    firstPriceKopecks: 2_990_000,
    promotion: null,
    offer: {
      published: true,
      benefitPeriods: [
        {
          capability: "product:625a0cca-c8ff-4a65-9125-17194dd3b769",
          months: null,
        },
        { capability: "community", months: null },
        { capability: "support", months: 6 },
      ],
    },
  });
  expect(quote.snapshot.offer.benefits).toEqual(
    expect.arrayContaining([
      "product:625a0cca-c8ff-4a65-9125-17194dd3b769",
      "community",
      "support",
    ]),
  );
  expect(quote.snapshot.offer.benefits).toHaveLength(3);
  expect(value(await billing.cohorts()).items).toEqual([
    expect.objectContaining({
      stage: "preorder",
      startsOn: "2026-11-09",
      priceAfterStartKopecks: 3_990_000,
    }),
  ]);
  const imported = await operations.execute(owner, {
    operation: "respondents.import",
    operationId: randomUUID(),
    list: "@synthetic_aie1359",
  });
  expect(imported.ok).toBe(true);
  const issueInput = {
    operation: "respondents.issue",
    templatePromotionId: "13590000-0000-4000-8000-000000000003",
  };
  expect(
    await operations.execute(owner, {
      ...issueInput,
      operationId: randomUUID(),
      username: "synthetic_unlisted1359",
    }),
  ).toMatchObject({ ok: false, error: { code: "not_found" } });
  async function issueLink() {
    const result = await operations.execute(owner, {
      ...issueInput,
      operationId: randomUUID(),
      username: "synthetic_aie1359",
    });
    if (!result.ok) throw new Error(result.error.code);
    if (result.result.outcome !== "respondentLink")
      throw new Error(result.result.outcome);
    return result.result.value;
  }
  const link = await issueLink();
  expect(link.alreadyIssued).toBe(false);
  expect(await issueLink()).toEqual({ ...link, alreadyIssued: true });
  const discounted = value(
    await billing.quote(buyer, {
      ...quoteInput,
      operationId: randomUUID(),
      promoCode: link.code,
    }),
  );
  expect(discounted.snapshot).toMatchObject({
    firstPriceKopecks: 2_691_000,
    promotion: { percent: 10 },
  });
  now = new Date("2026-11-08T20:59:59Z");
  const beforeStart = value(
    await billing.quote(buyer, { ...quoteInput, operationId: randomUUID() }),
  );
  now = new Date("2026-11-08T21:00:00Z");
  const expiredDiscount = value(
    await billing.quote(buyer, {
      ...quoteInput,
      operationId: randomUUID(),
      promoCode: link.code,
    }),
  );
  expect(expiredDiscount.snapshot).toMatchObject({
    firstPriceKopecks: 2_990_000,
    promotion: null,
  });
  for (const command of await commands("start-date"))
    value(await billing.manage(owner, command));
  expect(
    await billing.reserve({
      accountId: buyer,
      purchaseRef: randomUUID(),
      quoteRef: beforeStart.quoteRef,
      amountLimits: { minimumKopecks: 1, maximumKopecks: 10_000_000 },
    }),
  ).toMatchObject({ ok: false, error: { code: "quote_changed" } });
  const afterStart = value(
    await billing.quote(buyer, {
      ...quoteInput,
      optionRevision: 2,
      operationId: randomUUID(),
      promoCode: link.code,
    }),
  );
  expect(afterStart.snapshot).toMatchObject({
    firstPriceKopecks: 3_990_000,
    promotion: null,
    offer: { id: quote.snapshot.offer.id },
    paymentOption: { id: quote.snapshot.paymentOption.id, revision: 2 },
  });
  expect(value(await billing.offers({})).items[0]?.firstPriceKopecks).toBe(
    3_990_000,
  );
  expect(value(await billing.cohorts()).items[0]?.stage).toBe("running");
});
