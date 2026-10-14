import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, test } from "vitest";
import { assembleAccounts } from "../../src/modules/accounts/index.js";
import { assembleTestBillingPricing } from "./setup/billing-pricing.js";
import type { BillingPricing } from "../../src/modules/billing/index.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";
import { createQueryEventClient } from "./setup/query-events.js";

describe.each([1, 10, 100])(
  "product sale availability: %i memberships",
  (size) => {
    let db: TestDatabase | undefined;
    let measured: ReturnType<typeof createQueryEventClient> | undefined;
    let pricing: BillingPricing;
    let productIds: string[];
    let absent: string;
    beforeAll(async () => {
      db = await createMigratedTestDatabase();
      measured = createQueryEventClient(db.url);
      productIds = Array.from({ length: size }, () => randomUUID());
      absent = randomUUID();
      const offerIds = Array.from({ length: size }, () => randomUUID());
      await db.prisma.billingOffer.createMany({
        data: offerIds.map((id, index) => ({
          id,
          revision: 1,
          name: "Sold product",
          benefits: [`product:${productIds[index]}`, "support"],
          benefitPeriods: [{ capability: "support", months: 1 }],
          published: true,
        })),
      });
      await db.prisma.billingPaymentOption.createMany({
        data: offerIds.map((offerId) => ({
          id: randomUUID(),
          offerId,
          revision: 1,
          months: 1,
          mode: "one_time",
          priceKopecks: 10000n,
        })),
      });
      const accounts = assembleAccounts({
        prisma: measured.prisma,
        emailFingerprintKey: "sale-availability-fixture-fingerprint-key",
      });
      pricing = assembleTestBillingPricing({
        prisma: measured.prisma,
        accounts,
        clock: () => new Date("2030-01-01T00:00:00.000Z"),
        sale: { payments: true, subscriptions: true },
      });
    });
    afterAll(async () => {
      await measured?.prisma.$disconnect();
      await db?.dispose();
    });
    test("normalizes valid uppercase Product UUIDs through the Billing identity codec", async () => {
      const read = await pricing.saleAvailability({
        productIds: productIds.map((id) => id.toUpperCase()),
      });
      expect(read.ok).toBe(true);
      if (!read.ok) return;
      expect(read.value.items).toEqual(
        productIds.map((productId) => ({ productId, sold: true })),
      );
    });
    test("reports each sold Product and absent Product with bounded owner reads", async () => {
      if (measured === undefined)
        throw new Error("Missing measured fixture client");
      const read = await measured.measure(() =>
        pricing.saleAvailability({
          productIds: size === 100 ? productIds : [...productIds, absent],
        }),
      );
      expect(read.result.ok).toBe(true);
      if (!read.result.ok) return;
      expect(read.result.value.items).toEqual([
        ...productIds.map((productId) => ({ productId, sold: true })),
        ...(size === 100 ? [] : [{ productId: absent, sold: false }]),
      ]);
      expect(
        read.statements.filter((sql) => sql.startsWith("SELECT")).length,
      ).toBe(3);
    });
  },
);
