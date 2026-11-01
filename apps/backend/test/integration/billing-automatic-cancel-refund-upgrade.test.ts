import { randomUUID } from "node:crypto";
import { afterAll, expect, test } from "vitest";
import { z } from "zod";

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

const snapshot = {
  product: { id: "19320000-0000-4000-8000-00000000000a", name: "Курс" },
  offer: { id: "19320000-0000-4000-8000-00000000000a", benefits: [] },
  paymentOption: {
    id: "19320000-0000-4000-8000-00000000000a",
    mode: "one_time",
  },
};

async function purchase(database: TestDatabase): Promise<string> {
  const id = randomUUID();
  const quoteRef = randomUUID();
  const accountId = randomUUID();
  await database.prisma.$executeRaw`
    INSERT INTO billing.price_quotes (id, account_id, operation_id, fingerprint, snapshot, created_at, expires_at)
    VALUES (${quoteRef}::uuid, ${accountId}::uuid, ${randomUUID()}::uuid, ${`refund-${id}`},
      ${JSON.stringify(snapshot)}::jsonb, '2026-10-30T10:00:00Z', '2026-10-30T10:15:00Z')`;
  await database.prisma.$executeRaw`
    INSERT INTO billing.purchases (
      id, quote_ref, account_id, kind, state, environment, terminal_ref, payment_id,
      amount_kopecks, snapshot, acceptance, contact, fiscalization, lifecycle_active,
      confirmed_at, created_at, updated_at)
    VALUES (
      ${id}::uuid, ${quoteRef}::uuid, ${accountId}::uuid, 'one_time', 'confirmed', 'demo', 'REFUNDS',
      ${`payment-${id}`}, 150000, ${JSON.stringify(snapshot)}::jsonb, '{}'::jsonb, '{}'::jsonb,
      'not_configured', false, '2026-10-30T10:05:00Z', '2026-10-30T10:00:00Z', '2026-10-30T10:05:00Z')`;
  return id;
}

interface Decision {
  readonly purchaseRef: string;
  readonly actorId: string | null;
  readonly basis: string | null;
  readonly access: "keep" | "revoke";
  readonly state: "decided" | "executed";
}

async function decision(
  database: TestDatabase,
  value: Decision,
): Promise<string> {
  const id = randomUUID();
  const operationId = value.actorId === null ? null : randomUUID();
  await database.prisma.$executeRaw`
    INSERT INTO billing.refund_decisions (
      id, purchase_ref, account_id, actor_id, operation_id, amount_kopecks, basis, access,
      recurring, reason, state, revision, created_at, updated_at)
    VALUES (
      ${id}::uuid, ${value.purchaseRef}::uuid, ${randomUUID()}::uuid, ${value.actorId}::uuid,
      ${operationId}::uuid, 50000, ${value.basis}, ${value.access}, 'keep', 'historical decision',
      ${value.state}, 1, '2026-10-30T11:00:00Z', '2026-10-30T11:00:00Z')`;
  return id;
}

const rowsSchema = z.array(z.object({ value: z.unknown() }));

async function decisionRows(database: TestDatabase): Promise<unknown[]> {
  return rowsSchema
    .parse(
      await database.prisma.$queryRaw(Prisma.sql`
        select to_jsonb(d) as value from billing.refund_decisions d order by id
      `),
    )
    .map((row) => row.value);
}

async function rejectedByOrigin(attempt: Promise<unknown>): Promise<boolean> {
  try {
    await attempt;
    return false;
  } catch (error) {
    // Not a dependency failure: the test expects the refund origin constraint to reject the row.
    return String(error).includes("billing_refund_origin_check");
  }
}

test("the automatic cancel refund basis upgrade keeps every existing refund decision and admits the basis only without an owner", async () => {
  db = await createTestDatabase();
  await migrateBefore(db, "0118_billing_automatic_cancel_refund");
  const paid = await purchase(db);
  const owner = randomUUID();
  // Stored shapes before 0118: owner decisions with and without a basis, and a bank refund.
  await decision(db, {
    purchaseRef: paid,
    actorId: owner,
    basis: "compensation",
    access: "keep",
    state: "executed",
  });
  await decision(db, {
    purchaseRef: paid,
    actorId: owner,
    basis: null,
    access: "revoke",
    state: "decided",
  });
  await decision(db, {
    purchaseRef: paid,
    actorId: owner,
    basis: "withdrawal",
    access: "revoke",
    state: "executed",
  });
  await decision(db, {
    purchaseRef: paid,
    actorId: null,
    basis: "withdrawal",
    access: "keep",
    state: "executed",
  });
  const before = await decisionRows(db);

  await upgradeToLatest(db);

  expect(await decisionRows(db)).toEqual(before);
  const retired = await purchase(db);
  await decision(db, {
    purchaseRef: retired,
    actorId: null,
    basis: "automatic_cancel",
    access: "keep",
    state: "executed",
  });
  // An owner command never carries the automatic basis, and the automatic refund is never pending.
  expect(
    await rejectedByOrigin(
      decision(db, {
        purchaseRef: retired,
        actorId: owner,
        basis: "automatic_cancel",
        access: "keep",
        state: "executed",
      }),
    ),
  ).toBe(true);
  expect(
    await rejectedByOrigin(
      decision(db, {
        purchaseRef: retired,
        actorId: null,
        basis: "automatic_cancel",
        access: "keep",
        state: "decided",
      }),
    ),
  ).toBe(true);
});
