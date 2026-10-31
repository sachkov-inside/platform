import {
  fixedTestInstant,
  registerFixedClock,
} from "../support/fixed-clock.js";

import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { BillingOperations } from "../../src/modules/billing/index.js";
import { startPeopleApi, type PeopleApi } from "./setup/people-api.js";

registerFixedClock();

const instant = fixedTestInstant();
const DAY_MS = 24 * 60 * 60 * 1000;
const purchase = (n: number) =>
  `17194000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const quote = (n: number) =>
  `17194000-0000-4000-8000-${String(100 + n).padStart(12, "0")}`;

const snapshot = {
  offer: {
    id: "17194000-0000-4000-8000-0000000000d1",
    revision: 1,
    name: "Предложение",
    benefits: ["materials"],
    archived: false,
  },
  paymentOption: {
    id: "17194000-0000-4000-8000-0000000000d2",
    revision: 1,
    offerId: "17194000-0000-4000-8000-0000000000d1",
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

/**
 * Purchases created within one millisecond, three of them at the same microsecond. `created_at`
 * keeps microseconds; a JavaScript `Date` cannot, so only a cursor compared in SQL keeps them.
 * `pending`: a confirmed purchase whose fulfillment is not applied yet.
 */
const rows = [
  { n: 1, createdAt: "00.000123", state: "confirmed", pending: true },
  { n: 2, createdAt: "00.000123", state: "failed", pending: false },
  { n: 3, createdAt: "00.000123", state: "confirmed", pending: true },
  { n: 4, createdAt: "00.000456", state: "confirmed", pending: false },
  { n: 5, createdAt: "00.000789", state: "confirmed", pending: true },
  { n: 6, createdAt: "00.001000", state: "failed", pending: false },
  { n: 7, createdAt: "00.000789", state: "failed", pending: false },
  { n: 8, createdAt: "00.000100", state: "failed", pending: false },
];

/**
 * Payment events per purchase. `events=review` keeps purchases with an event for the owner to check
 * or a bank cancellation that is still open (#1928). `payment_confirmed` alone, a confirmed
 * cancellation and a cancellation closed by the confirmation of a paid form do not count.
 */
const events: Readonly<Record<number, readonly string[]>> = {
  1: ["payment_confirmed", "bank_cancel_requested", "bank_cancel_confirmed"],
  2: ["superseded_by_confirmed_payment"],
  3: ["payment_confirmed", "payment_confirmed_after_failure"],
  4: ["payment_confirmed"],
  5: ["payment_confirmed", "duplicate_payment_review"],
  6: ["bank_cancel_requested"],
  7: ["bank_payment_absent"],
  8: ["bank_cancel_requested", "bank_cancel_confirmed"],
};

/** `created_at desc, id desc`: microseconds first, the ID breaks the remaining ties. */
const newestFirst = [6, 7, 5, 4, 3, 2, 1, 8].map(purchase);

/**
 * The cursor of `payments.list` (#1719, R3): traversal through purchases that share a creation
 * microsecond or differ below a millisecond returns every row once, in order, under each filter.
 */
describe("Payments list cursor", () => {
  let api: PeopleApi;
  let ownerId = "";

  beforeAll(async () => {
    api = await startPeopleApi();
    ownerId = (await api.signedIn("billing:manage")).accountId;
    const buyer = await api.person({ signInEmail: "buyer@example.test" });
    const prisma = api.database.prisma;
    await prisma.billingPriceQuote.createMany({
      data: rows.map((row) => ({
        id: quote(row.n),
        accountId: buyer,
        operationId: randomUUID(),
        fingerprint: `cursor-${String(row.n)}`,
        snapshot,
        createdAt: new Date(instant - 2 * DAY_MS),
        expiresAt: new Date(instant - DAY_MS),
      })),
    });
    for (const row of rows)
      await prisma.$executeRaw`
        INSERT INTO billing.purchases (
          id, quote_ref, account_id, kind, state, environment, terminal_ref, payment_id,
          amount_kopecks, snapshot, acceptance, contact, fiscalization, confirmed_at,
          lifecycle_active, created_at, updated_at)
        VALUES (
          ${purchase(row.n)}::uuid, ${quote(row.n)}::uuid, ${buyer}::uuid, 'one_time',
          ${row.state}, 'demo', 'CURSOR', ${String(row.n)}, 150000,
          ${JSON.stringify(snapshot)}::jsonb, '{}'::jsonb, '{}'::jsonb, 'pending',
          ${row.state === "confirmed" ? new Date(instant - DAY_MS) : null},
          false,
          ${`2026-10-01T10:00:${row.createdAt}Z`}::timestamptz,
          ${`2026-10-01T10:00:${row.createdAt}Z`}::timestamptz)`;
    await prisma.billingFulfillment.createMany({
      data: rows
        .filter((row) => row.state === "confirmed")
        .map((row) => ({
          eventRef: randomUUID(),
          purchaseRef: purchase(row.n),
          payload: {},
          appliedAt: row.pending ? null : new Date(instant - DAY_MS),
        })),
    });
    await prisma.billingPaymentEvent.createMany({
      data: Object.entries(events).flatMap(([n, kinds]) =>
        kinds.map((kind) => ({
          id: randomUUID(),
          purchaseRef: purchase(Number(n)),
          kind,
          payload: {},
          occurredAt: new Date(instant - DAY_MS),
          recordedAt: new Date(instant - DAY_MS),
        })),
      ),
    });
  });

  afterAll(async () => {
    await api.close();
  });

  /** Every page of one filter through `nextCursor`, as purchase refs. */
  async function traverse(
    filter: Record<string, unknown>,
    limit: number,
  ): Promise<string[]> {
    const billing = api.app.get(BillingOperations);
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let pages = 0; pages <= rows.length; pages += 1) {
      const result = await billing.execute(ownerId, {
        operation: "payments.list",
        operationId: randomUUID(),
        ...filter,
        limit,
        ...(cursor === undefined ? {} : { cursor }),
      });
      if (!result.ok || result.result.outcome !== "payments")
        throw new Error(JSON.stringify(result));
      seen.push(...result.result.items.map((item) => item.purchaseRef));
      if (result.result.nextCursor === null) return seen;
      cursor = result.result.nextCursor;
    }
    throw new Error("The traversal did not end");
  }

  const pick = (keep: (row: (typeof rows)[number]) => boolean) =>
    newestFirst.filter((ref) =>
      rows.some((row) => purchase(row.n) === ref && keep(row)),
    );

  test.each([1, 2])(
    "pages of %i return every purchase once, newest microsecond first",
    async (limit) => {
      expect(await traverse({}, limit)).toEqual(newestFirst);
    },
  );

  test.each([1, 2])(
    "pages of %i keep fulfillment=incomplete across shared microseconds",
    async (limit) => {
      expect(await traverse({ fulfillment: "incomplete" }, limit)).toEqual(
        pick((row) => row.pending),
      );
    },
  );

  test.each([1, 2])(
    "pages of %i keep events=review across shared microseconds",
    async (limit) => {
      expect(await traverse({ events: "review" }, limit)).toEqual(
        newestFirst.filter((ref) =>
          [2, 3, 5, 6, 7].map(purchase).includes(ref),
        ),
      );
    },
  );

  test("events=review combines with a states filter", async () => {
    expect(await traverse({ events: "review", states: ["failed"] }, 2)).toEqual(
      newestFirst.filter((ref) => [2, 6, 7].map(purchase).includes(ref)),
    );
  });

  test.each([1, 2])(
    "pages of %i keep a states filter across shared microseconds",
    async (limit) => {
      expect(await traverse({ states: ["failed"] }, limit)).toEqual(
        pick((row) => row.state === "failed"),
      );
    },
  );
});
