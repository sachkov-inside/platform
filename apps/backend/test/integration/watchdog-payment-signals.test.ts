import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { afterEach, beforeEach, expect, it } from "vitest";
import { z } from "zod";

import {
  bankCancelEventKinds,
  reviewPaymentEventKinds,
} from "../../src/modules/billing/features/read-payments/read-payments.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

/**
 * The production watchdog (#1928) reads payment signals with one SQL statement. This contract runs
 * that statement from the script itself against the migrated billing schema in a read-only
 * transaction, as the watchdog does: a renamed table or column fails here, not on the server.
 * Event kinds are compared only with the owner payments filter, not with the code that writes them.
 */
const watchdog = readFileSync(
  new URL(
    "../../../../infra/production/watchdog/inside-watchdog",
    import.meta.url,
  ),
  "utf8",
);
const paymentQuery =
  /read -r -d '' payment_query <<'SQL' \|\| true\n([\s\S]*?)\nSQL\n/u.exec(
    watchdog,
  )?.[1] ?? "";

const snapshot = {
  offer: {
    id: "19280000-0000-4000-8000-0000000000d1",
    revision: 1,
    name: "Предложение",
    benefits: ["materials"],
    archived: false,
  },
  paymentOption: {
    id: "19280000-0000-4000-8000-0000000000d2",
    revision: 1,
    offerId: "19280000-0000-4000-8000-0000000000d1",
    months: 1,
    priceKopecks: 150000,
    archived: false,
  },
  promotion: null,
  currency: "RUB",
  timezone: "Europe/Moscow",
  firstPriceKopecks: 150000,
  renewalPriceKopecks: 150000,
};

let database: TestDatabase;
beforeEach(async () => {
  database = await createMigratedTestDatabase();
});
afterEach(async () => {
  await database.dispose();
});

/**
 * A one-time purchase, failed unless stated, created `age` ago by the database clock, as an
 * interval literal. Database-clock adapter contract: the fixture and the watchdog query both use
 * SQL now(), and each age stays away from its window edge by at least ten minutes.
 */
async function oneTimePurchase(
  accountId: string,
  age: string,
  paymentId: string | null = null,
  state: "failed" | "confirmed" = "failed",
): Promise<string> {
  const id = randomUUID();
  const quoteRef = randomUUID();
  await database.prisma.$executeRaw`
    INSERT INTO billing.price_quotes (id, account_id, operation_id, fingerprint, snapshot, created_at, expires_at)
    VALUES (${quoteRef}::uuid, ${accountId}::uuid, ${randomUUID()}::uuid, ${`watchdog-${id}`},
      ${JSON.stringify(snapshot)}::jsonb, now() - ${age}::interval, now() + interval '1 hour')`;
  await database.prisma.$executeRaw`
    INSERT INTO billing.purchases (
      id, quote_ref, account_id, kind, state, environment, terminal_ref, payment_id,
      amount_kopecks, snapshot, acceptance, contact, fiscalization, lifecycle_active,
      confirmed_at, created_at, updated_at)
    VALUES (
      ${id}::uuid, ${quoteRef}::uuid, ${accountId}::uuid, 'one_time', ${state}, 'demo', 'WATCHDOG',
      ${paymentId}, 150000, ${JSON.stringify(snapshot)}::jsonb, '{}'::jsonb, '{}'::jsonb,
      'not_configured', false,
      CASE WHEN ${state} = 'confirmed' THEN now() - ${age}::interval END,
      now() - ${age}::interval, now() - ${age}::interval)`;
  return id;
}

async function event(purchaseRef: string, kind: string, age: string) {
  await database.prisma.$executeRaw`
    INSERT INTO billing.payment_events (id, purchase_ref, kind, payload, occurred_at, recorded_at)
    VALUES (${randomUUID()}::uuid, ${purchaseRef}::uuid, ${kind}, '{}'::jsonb,
      now() - ${age}::interval, now() - ${age}::interval)`;
}

const signalRowsSchema = z.array(
  z.tuple([z.string(), z.bigint()]).transform(([name, value]) => ({
    name,
    value,
  })),
);

/** The query as the watchdog runs it: one read-only transaction, rows `name | count`. */
async function readSignals(): Promise<Record<string, number>> {
  const rows: unknown = await database.prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    // The statement is a checked-in literal from the watchdog script, not request input.
    return tx.$queryRawUnsafe(paymentQuery);
  });
  return Object.fromEntries(
    signalRowsSchema
      .parse(
        z
          .array(z.record(z.string(), z.unknown()))
          .parse(rows)
          .map((row) => Object.values(row)),
      )
      .map(({ name, value }) => [name, Number(value)]),
  );
}

it("reads no payment signals from an empty billing schema", async () => {
  expect(paymentQuery).not.toBe("");
  expect(await readSignals()).toEqual({
    payment_duplicate: 0,
    payment_after_failure: 0,
    payment_superseded: 0,
    payment_bank_absent: 0,
    payment_cancel_open: 0,
    payment_failed_burst: 0,
  });
});

it("counts recent payment events, open bank cancellations and failed bursts", async () => {
  const buyer = randomUUID();
  const recent = await oneTimePurchase(buyer, "2 hours");
  const older = await oneTimePurchase(buyer, "3 days");
  const other = await oneTimePurchase(buyer, "2 hours", "PAID-1");
  await event(recent, "duplicate_payment_review", "1 minute");
  await event(older, "duplicate_payment_review", "25 hours");
  await event(recent, "payment_confirmed_after_failure", "1 minute");
  await event(recent, "superseded_by_confirmed_payment", "1 minute");
  await event(other, "superseded_by_confirmed_payment", "23 hours");
  await event(recent, "bank_payment_absent", "1 minute");
  await event(recent, "payment_confirmed", "1 minute");

  // Open: requested 40 minutes ago, never confirmed. Closed, too fresh, expired and paid do not count.
  const open = await oneTimePurchase(randomUUID(), "2 hours", "CANCEL-OPEN");
  const closed = await oneTimePurchase(
    randomUUID(),
    "2 hours",
    "CANCEL-CLOSED",
  );
  const fresh = await oneTimePurchase(randomUUID(), "2 hours", "CANCEL-FRESH");
  const expired = await oneTimePurchase(randomUUID(), "3 days", "CANCEL-OLD");
  const paid = await oneTimePurchase(
    randomUUID(),
    "2 hours",
    "CANCEL-PAID",
    "confirmed",
  );
  await event(open, "bank_cancel_requested", "40 minutes");
  await event(paid, "bank_cancel_requested", "40 minutes");
  await event(closed, "bank_cancel_requested", "40 minutes");
  await event(closed, "bank_cancel_confirmed", "20 minutes");
  await event(fresh, "bank_cancel_requested", "10 minutes");
  await event(expired, "bank_cancel_requested", "50 hours");

  // Burst: four failed one-time purchases without PaymentId within the hour for one Account.
  const burst = randomUUID();
  for (let n = 0; n < 4; n += 1) await oneTimePurchase(burst, "20 minutes");
  // Three is the threshold, not a burst.
  const three = randomUUID();
  for (let n = 0; n < 3; n += 1) await oneTimePurchase(three, "20 minutes");
  // A PaymentId or an attempt older than the hour leaves three in the window.
  const withPayment = randomUUID();
  for (let n = 0; n < 3; n += 1)
    await oneTimePurchase(withPayment, "20 minutes");
  await oneTimePurchase(withPayment, "20 minutes", "BANK-1");
  const aged = randomUUID();
  for (let n = 0; n < 3; n += 1) await oneTimePurchase(aged, "20 minutes");
  await oneTimePurchase(aged, "80 minutes");

  expect(await readSignals()).toEqual({
    payment_duplicate: 1,
    payment_after_failure: 1,
    payment_superseded: 2,
    payment_bank_absent: 1,
    payment_cancel_open: 1,
    payment_failed_burst: 1,
  });
});

it("watches every event kind that the owner payments filter offers for review", () => {
  for (const kind of [
    ...reviewPaymentEventKinds,
    ...Object.values(bankCancelEventKinds),
  ])
    expect(paymentQuery).toContain(`'${kind}'`);
});
