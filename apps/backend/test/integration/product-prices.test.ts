import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { BillingPricing } from "../../src/modules/billing/index.js";
import { assembleAccounts } from "../../src/modules/accounts/index.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";
let db: TestDatabase;
const owner = randomUUID(),
  productId = randomUUID();
let pricing: BillingPricing;
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
  pricing = new BillingPricing({
    prisma: db.prisma,
    accounts: assembleAccounts({
      prisma: db.prisma,
      emailFingerprintKey: "product-prices-test-key-000000000000",
    }),
    sale: { payments: true, subscriptions: false },
  });
});
afterAll(async () => db.dispose());
test("one Product price can be saved and priced directly without tariff or payment option", async () => {
  const result = await pricing.manage(owner, {
    operation: "productPrices.save",
    operationId: randomUUID(),
    value: { productId, name: "Курс", priceKopecks: 10001, published: true },
  });
  expect(result).toMatchObject({
    ok: true,
    value: { id: productId, revision: 1, published: true },
  });
  const quoted = await pricing.quote(owner, {
    operationId: randomUUID(),
    productId,
    priceRevision: 1,
  });
  expect(quoted).toMatchObject({
    ok: true,
    value: {
      snapshot: {
        product: { id: productId, name: "Курс" },
        supportMonths: 3,
        firstPriceKopecks: 10001,
      },
    },
  });
});
