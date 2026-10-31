import { afterAll, expect, test } from "vitest";
import { z } from "zod";
import { isPostgresUniqueViolation } from "../../src/infrastructure/content-authoring/postgres-error-mapping.js";
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

const productA = "19240000-0000-4000-8000-00000000000a";
const productB = "19240000-0000-4000-8000-00000000000b";
const buyer = "19240000-0000-4000-8000-000000000b01";
const legacyBuyer = "19240000-0000-4000-8000-000000000b02";
const malformedBuyer = "19240000-0000-4000-8000-000000000b03";
const uppercaseBuyer = "19240000-0000-4000-8000-000000000b04";

function productSnapshot(productId: string) {
  return {
    product: { id: productId, name: "Курс", priceRevision: 1 },
    offer: { id: productId, benefits: [`product:${productId}`] },
    paymentOption: { id: productId, offerId: productId, mode: "one_time" },
  };
}
// A recurring offer reservation saved before Product prices (0108): it names no Product.
const legacySnapshot = {
  offer: {
    id: "19240000-0000-4000-8000-0000000000f1",
    benefits: ["materials"],
  },
  paymentOption: {
    id: "19240000-0000-4000-8000-0000000000f2",
    offerId: "19240000-0000-4000-8000-0000000000f1",
    mode: "subscription",
  },
};

const reservationRows = z.array(
  z.strictObject({
    purchase_ref: z.string(),
    product_id: z.string().nullable(),
  }),
);
const indexRows = z.array(
  z.strictObject({ indexname: z.string(), indexdef: z.string() }),
);

let sequence = 0;
async function seedReservation(
  database: TestDatabase,
  accountId: string,
  state: string,
  snapshot: unknown,
): Promise<string> {
  sequence += 1;
  const suffix = String(sequence).padStart(12, "0");
  const quoteRef = `19240000-0000-4000-8001-${suffix}`;
  const purchaseRef = `19240000-0000-4000-8002-${suffix}`;
  const json = JSON.stringify(snapshot);
  await database.prisma.$executeRaw(Prisma.sql`
    insert into billing.price_quotes(id, account_id, operation_id, fingerprint, snapshot, created_at, expires_at)
    values (${quoteRef}::uuid, ${accountId}::uuid, ${quoteRef}::uuid, 'historical', ${json}::jsonb,
      '2026-10-30T10:00:00Z'::timestamptz, '2026-10-31T10:00:00Z'::timestamptz)
  `);
  await database.prisma.$executeRaw(Prisma.sql`
    insert into billing.promo_reservations(purchase_ref, account_id, quote_ref, state, snapshot)
    values (${purchaseRef}::uuid, ${accountId}::uuid, ${quoteRef}::uuid, ${state}, ${json}::jsonb)
  `);
  return purchaseRef;
}

async function rejectedByOpenProductReservation(
  attempt: Promise<unknown>,
): Promise<boolean> {
  try {
    await attempt;
    return false;
  } catch (error) {
    // Not a dependency failure: the test expects this constraint to reject the row.
    return isPostgresUniqueViolation(
      error,
      "billing_one_open_product_reservation",
    );
  }
}

test("the per-Product open reservation upgrade keys existing rows by their saved Product and frees historical rows without one", async () => {
  db = await createTestDatabase();
  await migrateBefore(db, "0116_billing_open_reservation_per_product");
  const openProduct = await seedReservation(
    db,
    buyer,
    "sent",
    productSnapshot(productA),
  );
  const failedProduct = await seedReservation(
    db,
    buyer,
    "failed",
    productSnapshot(productA),
  );
  const confirmedProduct = await seedReservation(
    db,
    buyer,
    "confirmed",
    productSnapshot(productA),
  );
  const openLegacy = await seedReservation(
    db,
    legacyBuyer,
    "unknown",
    legacySnapshot,
  );
  const malformedId = await seedReservation(db, malformedBuyer, "reserved", {
    ...productSnapshot(productA),
    product: { id: "not-a-uuid", name: "Курс", priceRevision: 1 },
  });
  const numericId = await seedReservation(db, malformedBuyer, "failed", {
    ...productSnapshot(productA),
    product: { id: 42 },
  });
  const uppercase = await seedReservation(
    db,
    uppercaseBuyer,
    "reserved",
    productSnapshot(productB.toUpperCase()),
  );

  await upgradeToLatest(db);

  const keyed = reservationRows.parse(
    await db.prisma.$queryRaw(Prisma.sql`
      select purchase_ref::text, product_id::text
      from billing.promo_reservations
      order by purchase_ref
    `),
  );
  expect(keyed).toEqual(
    [
      { purchase_ref: openProduct, product_id: productA },
      { purchase_ref: failedProduct, product_id: productA },
      { purchase_ref: confirmedProduct, product_id: productA },
      { purchase_ref: openLegacy, product_id: null },
      { purchase_ref: malformedId, product_id: null },
      { purchase_ref: numericId, product_id: null },
      { purchase_ref: uppercase, product_id: productB },
    ].sort((left, right) =>
      left.purchase_ref.localeCompare(right.purchase_ref),
    ),
  );
  const indexes = indexRows.parse(
    await db.prisma.$queryRaw(Prisma.sql`
      select indexname::text, indexdef
      from pg_indexes
      where schemaname = 'billing'
        and indexname in ('billing_one_open_pricing_reservation', 'billing_one_open_product_reservation')
    `),
  );
  expect(indexes.map((index) => index.indexname)).toEqual([
    "billing_one_open_product_reservation",
  ]);
  expect(indexes[0]?.indexdef).toMatch(
    /^CREATE UNIQUE INDEX billing_one_open_product_reservation ON billing\.promo_reservations USING btree \(account_id, product_id\) WHERE \(state = ANY \(ARRAY\['reserved'::text, 'sent'::text, 'unknown'::text\]\)\)$/u,
  );

  // The historical open row no longer blocks its Account; another Product opens beside it.
  await seedReservation(db, legacyBuyer, "reserved", productSnapshot(productA));
  await seedReservation(db, buyer, "reserved", productSnapshot(productB));
  // The same Product stays limited to one open reservation per Account.
  expect(
    await rejectedByOpenProductReservation(
      seedReservation(db, buyer, "reserved", productSnapshot(productA)),
    ),
  ).toBe(true);
});
