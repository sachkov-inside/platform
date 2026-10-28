import { randomUUID } from "node:crypto";
import {
  beforeAll,
  afterAll,
  describe,
  expect,
  onTestFinished,
  test,
} from "vitest";
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
      await db.prisma.product.createMany({
        data: productIds.map((id) => ({ id, slug: id, name: "Sold Product" })),
      });
      await db.prisma.billingProductPrice.createMany({
        data: productIds.map((productId) => ({
          productId,
          revision: 1,
          name: "Sold Product",
          priceKopecks: 10000n,
          published: true,
          updatedAt: new Date("2030-01-01T00:00:00Z"),
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
        sale: { payments: true },
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
      // Price rows, Product catalogue and active promotions. No fixture promotion has a usage
      // limit, so the shared promotion usage read is skipped. The count is the same at every size.
      expect(
        read.statements.filter((sql) => sql.startsWith("SELECT")).length,
      ).toBe(3);
    });
    test("reads promotion usage once for a usage-limited promotion at any size", async () => {
      if (measured === undefined || db === undefined)
        throw new Error("Missing measured fixture client");
      const promotionId = randomUUID();
      await db.prisma.billingPromotion.create({
        data: {
          id: promotionId,
          revision: 1,
          name: "Limited promotion",
          percent: 10,
          startsAt: new Date("2029-12-01T00:00:00Z"),
          endsAt: new Date("2030-02-01T00:00:00Z"),
          productIds,
          usageLimit: 5,
        },
      });
      // The promotion would otherwise change the read count of the other tests of this size.
      onTestFinished(async () => {
        await db?.prisma.billingPromotion.delete({
          where: { id: promotionId },
        });
      });
      const read = await measured.measure(() =>
        pricing.saleAvailability({ productIds }),
      );
      expect(read.result).toEqual({
        ok: true,
        value: {
          items: productIds.map((productId) => ({ productId, sold: true })),
        },
      });
      // The shared promotion usage read joins the three reads above, once per batch.
      expect(
        read.statements.filter((sql) => sql.startsWith("SELECT")).length,
      ).toBe(4);
    });
  },
);
