import { afterAll, beforeAll, expect, test } from "vitest";
import {
  BillingPayments,
  BillingNotices,
} from "../../src/modules/billing/index.js";
import { readPayment } from "../../src/modules/billing/features/read-payments/read-payments.js";
import { createMigratedTestDatabase } from "./setup/test-database.js";
import { createQueryEventClient } from "./setup/query-events.js";

const sizes = [1, 100, 101] as const;
const id = (group: number, n: number) =>
  `${String(group).padStart(8, "0")}-0000-4000-8000-${String(n).padStart(12, "0")}`;
const now = new Date("2026-10-01T00:00:00.000Z");
const snapshot = {
  offer: {
    id: id(601, 1),
    revision: 1,
    name: "История",
    benefits: ["materials"],
    archived: false,
  },
  paymentOption: {
    id: id(602, 1),
    revision: 1,
    offerId: id(601, 1),
    months: 1,
    priceKopecks: 1000,
    archived: false,
  },
  promotion: null,
  currency: "RUB",
  timezone: "Europe/Moscow",
  firstPriceKopecks: 1000,
  renewalPriceKopecks: 1000,
};
let database: Awaited<ReturnType<typeof createMigratedTestDatabase>>;
let observer: ReturnType<typeof createQueryEventClient>;
beforeAll(async () => {
  database = await createMigratedTestDatabase();
  observer = createQueryEventClient(database.url);
  await database.prisma.account.create({
    data: {
      id: id(600, 1),
      logtoIssuer: "https://identity.example.test",
      logtoSubject: "history-cost",
    },
  });
  await database.prisma.account.create({
    data: {
      id: id(600, 2),
      logtoIssuer: "https://identity.example.test",
      logtoSubject: "recent-history-cost",
    },
  });
  await database.prisma.billingPriceQuote.createMany({
    data: Array.from({ length: 51 }, (_, index) => ({
      id: id(610, index + 1),
      accountId: id(600, 2),
      operationId: id(610, index + 1),
      fingerprint: "recent-history-cost",
      snapshot,
      createdAt: now,
      expiresAt: new Date("2026-10-02T00:00:00.000Z"),
    })),
  });
  await database.prisma.billingPurchase.createMany({
    data: Array.from({ length: 51 }, (_, index) => ({
      id: id(611, index + 1),
      quoteRef: id(610, index + 1),
      accountId: id(600, 2),
      state: "failed",
      kind: "initial",
      lifecycleActive: false,
      environment: "demo",
      terminalRef: "SYNTHETICHISTORY",
      amountKopecks: 1000n,
      snapshot,
      acceptance: {},
      contact: {},
      fiscalization: "pending",
      createdAt: new Date(now.getTime() + index),
      updatedAt: now,
    })),
  });
  await database.prisma.billingNotice.createMany({
    data: Array.from({ length: 21 }, (_, index) => ({
      id: id(612, index + 1),
      accountId: id(600, 2),
      kind: "payment_succeeded",
      sourceRef: `payment:${id(611, index + 1)}`,
      revision: 1,
      state: "current",
      occurredAt: new Date(now.getTime() + index),
      notAfter: new Date("2026-10-02T00:00:00.000Z"),
      title: "Оплата",
      amountKopecks: 1000n,
      createdAt: now,
      updatedAt: now,
    })),
  });
  for (const size of sizes) {
    const purchaseRef = id(603, size);
    await database.prisma.billingPriceQuote.create({
      data: {
        id: id(605, size),
        accountId: id(600, 1),
        operationId: id(605, size),
        fingerprint: "history-cost",
        snapshot,
        createdAt: now,
        expiresAt: new Date("2026-10-02T00:00:00.000Z"),
      },
    });
    await database.prisma.billingPurchase.create({
      data: {
        id: purchaseRef,
        quoteRef: id(605, size),
        accountId: id(600, 1),
        state: "failed",
        kind: "initial",
        lifecycleActive: false,
        environment: "demo",
        terminalRef: "SYNTHETICHISTORY",
        amountKopecks: 1000n,
        snapshot,
        acceptance: {},
        contact: {},
        fiscalization: "pending",
        createdAt: now,
        updatedAt: now,
      },
    });
    await database.prisma.billingOwnerCommand.createMany({
      data: Array.from({ length: size }, (_, index) => ({
        actorId: id(600, 1),
        operationId: id(604 + size, index + 1),
        operation: "payments.reconcile",
        fingerprint: "history-cost",
        targetRef: purchaseRef,
        reason: String(index + 1),
        result: {},
        createdAt: now,
      })),
    });
  }
});
afterAll(async () => {
  await observer.prisma.$disconnect();
  await database.dispose();
});
for (const size of sizes) {
  test(`payment audit reaches every command in sequence order at ${String(size)} rows`, async () => {
    const purchaseRef = id(603, size);
    const measured = await observer.measure(() =>
      readPayment(observer.prisma, purchaseRef),
    );
    if (!measured.result.ok) throw new Error(measured.result.error.code);
    process.stdout.write(
      `${JSON.stringify({ record: "PC-6", fixture: size, readStatements: measured.statements.length, auditRows: measured.result.result.audit.length, returnedCursorContract: "nextAuditCursor" in measured.result.result })}\n`,
    );
    expect(measured.result.result.audit).toHaveLength(Math.min(size, 100));
    const cursor = measured.result.result.nextAuditCursor;
    if (size <= 100) expect(cursor).toBeNull();
    else {
      expect(cursor).not.toBeNull();
      const next = await observer.measure(() =>
        readPayment(observer.prisma, purchaseRef, cursor ?? undefined),
      );
      if (!next.result.ok) throw new Error(next.result.error.code);
      expect(next.result.result.audit.map((entry) => entry.reason)).toEqual([
        "101",
      ]);
      expect(next.result.result.nextAuditCursor).toBeNull();
      expect(
        [...measured.result.result.audit, ...next.result.result.audit].map(
          (entry) => entry.reason,
        ),
      ).toEqual(Array.from({ length: size }, (_, i) => String(i + 1)));
      const other = await readPayment(
        observer.prisma,
        id(603, 1),
        cursor ?? undefined,
      );
      expect(other).toMatchObject({
        ok: false,
        error: { code: "invalid_request" },
      });
      process.stdout.write(
        `${JSON.stringify({ record: "PC-6", fixture: size, ownerCalls: 2, providerRequests: 0, statements: [measured.statements.length, next.statements.length], rows: [measured.result.result.audit.length, next.result.result.audit.length] })}\n`,
      );
    }
    process.stdout.write(
      `${JSON.stringify({ record: "PC-6", fixture: size, ownerCalls: 1, providerRequests: 0, statements: measured.statements.length, auditRows: measured.result.result.audit.length })}\n`,
    );
  });
}

const unused = () =>
  Promise.reject(new Error("Unexpected external boundary in history read"));
test("recent cabinet windows retain latest 50 payments and 20 notices with Account isolation", async () => {
  const payments = new BillingPayments({
    prisma: observer.prisma,
    bank: undefined,
    contact: { read: unused, readConsents: unused },
    grants: {
      readCompatibilityCoverage: unused,
      readLegacyClassification: unused,
      readPurchaseGrounds: unused,
      resolveCapabilities: unused,
      applyPaidPeriod: unused,
    },
    clock: () => now,
  });
  const notices = new BillingNotices({
    prisma: observer.prisma,
    enrollments: {
      listEnrollmentEndings: unused,
      readEnrollmentEnding: unused,
      readSubscriptionContinuation: unused,
    },
    clock: () => now,
  });
  const money = await observer.measure(() => payments.history(id(600, 2)));
  if (!money.result.ok) throw new Error(money.result.error.code);
  expect(money.result.value.map((entry) => entry.purchaseRef)).toEqual(
    Array.from({ length: 50 }, (_, index) => id(611, 51 - index)),
  );
  const messages = await observer.measure(() =>
    notices.readNotices(id(600, 2)),
  );
  expect(messages.result.map((entry) => entry.noticeRef)).toEqual(
    Array.from({ length: 20 }, (_, index) => id(612, 21 - index)),
  );
  expect(money.statements).toHaveLength(2);
  expect(messages.statements).toHaveLength(1);
  process.stdout.write(
    `${JSON.stringify({ record: "PC-6", scope: "recent cabinet", inputRows: [51, 21], returnedRows: [50, 20], statements: [money.statements.length, messages.statements.length], ownerCalls: 2, providerRequests: 0 })}\n`,
  );
});
