import { afterAll, expect, test } from "vitest";
import { Prisma } from "../../src/infrastructure/prisma/index.js";
import { migrateBefore, upgradeToLatest } from "./setup/historical-upgrade.js";
import {
  createTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

let db: TestDatabase | undefined;
afterAll(async () => {
  await db?.dispose();
});
test("historical sales presentation rename preserves revision, identity, calendar and display amount through replay", async () => {
  db = await createTestDatabase();
  await migrateBefore(db, "0110_product_sales_state");
  const productId = "47001710-0000-4000-8000-000000000001";
  await db.prisma.$executeRaw(Prisma.sql`
    insert into billing.product_cohorts(product_id, revision, name, stage, starts_on, next_event, price_after_start_kopecks, updated_at)
    values (${productId}::uuid, 7, 'Original intake name', 'preorder', '2020-01-01'::date, 'Original event', 1600000, '2020-01-02T12:00:00Z'::timestamptz)
  `);
  await upgradeToLatest(db);
  expect(
    await db.prisma.billingProductSalesState.findUniqueOrThrow({
      where: { productId },
    }),
  ).toEqual({
    productId,
    revision: 7,
    name: "Original intake name",
    stage: "preorder",
    startsOn: new Date("2020-01-01T00:00:00Z"),
    nextEvent: "Original event",
    priceAfterStartKopecks: 1600000n,
    updatedAt: new Date("2020-01-02T12:00:00Z"),
  });
  expect(await db.prisma.billingProductPrice.count()).toBe(0);
  expect(await db.prisma.productWaitlistIntake.count()).toBe(0);
});
