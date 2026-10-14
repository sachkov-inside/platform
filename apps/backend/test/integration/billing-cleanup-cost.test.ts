import {
  lockBillingPricing,
  lockBillingSubscription,
} from "../../src/infrastructure/prisma/index.js";
import { advanceSubscription } from "../../src/modules/billing/shared/subscription-outcome.js";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import {
  closeLapsedSubscriptions,
  dueRenewals,
} from "../../src/modules/billing/shared/renewal-schedule.js";
import { createMigratedTestDatabase } from "./setup/test-database.js";
import { createQueryEventClient } from "./setup/query-events.js";

const sizes = [1, 20, 100] as const;
const now = new Date("2026-10-01T00:00:00.000Z");
const start = new Date("2026-09-01T00:00:00.000Z");
const expired = new Date("2026-09-30T00:00:00.000Z");
const id = (group: number, n: number) =>
  `${String(group).padStart(8, "0")}-0000-4000-8000-${String(n).padStart(12, "0")}`;
const offer = {
  id: id(701, 1),
  revision: 1,
  name: "Продление",
  benefits: ["materials"],
  archived: false,
};
const paymentOption = {
  id: id(702, 1),
  offerId: offer.id,
  revision: 1,
  months: 1,
  priceKopecks: 1000,
  archived: false,
};
const snapshot = {
  offer,
  paymentOption,
  currency: "RUB",
  timezone: "Europe/Moscow",
  renewalPriceKopecks: 1000,
};
const fullSnapshot = { ...snapshot, promotion: null, firstPriceKopecks: 1000 };
async function corpus(size: number) {
  const database = await createMigratedTestDatabase();
  const observer = createQueryEventClient(database.url);
  try {
    await database.prisma.account.createMany({
      data: Array.from({ length: 2 * size + 1 }, (_, index) => ({
        id: id(700, index + 1),
        logtoIssuer: "https://identity.example.test",
        logtoSubject: `cleanup-${String(index + 1)}`,
      })),
    });
    await database.prisma.billingSubscription.createMany({
      data: Array.from({ length: 2 * size + 1 }, (_, index) => ({
        id: id(703, index + 1),
        accountId: id(700, index + 1),
        state: index < size || index === 2 * size ? "canceled" : "active",
        snapshot,
        consent: {},
        anchorAt: start,
        anchorMonths: 1,
        periodIndex: 1,
        periodStartsAt: start,
        paidUntil: expired,
        periodAmountKopecks: 1000n,
        bindingRef:
          index >= size && index < 2 * size ? id(704, index + 1) : null,
        bindingCiphertext:
          index >= size && index < 2 * size
            ? "synthetic-encrypted-binding"
            : null,
        revision: 1,
        createdAt: start,
        updatedAt: start,
      })),
    });
    await database.prisma.billingPurchase.create({
      data: {
        id: id(705, 1),
        accountId: id(700, 2 * size + 1),
        subscriptionRef: id(703, 2 * size + 1),
        kind: "renewal",
        periodIndex: 2,
        state: "unknown",
        environment: "demo",
        terminalRef: "SYNTHETICCLEANUP",
        amountKopecks: 1000n,
        snapshot: fullSnapshot,
        acceptance: {},
        contact: {},
        fiscalization: "pending",
        lifecycleActive: false,
        createdAt: expired,
        updatedAt: expired,
      },
    });
    return {
      size,
      database,
      observer,
      async dispose() {
        await observer.prisma.$disconnect();
        await database.dispose();
      },
    };
  } catch (error) {
    await observer.prisma.$disconnect();
    await database.dispose();
    throw error;
  }
}
const corpora: Awaited<ReturnType<typeof corpus>>[] = [];
beforeAll(async () => {
  for (const size of sizes) corpora.push(await corpus(size));
  corpora.push(await corpus(1));
});
afterAll(async () => {
  await Promise.all(corpora.map((entry) => entry.dispose()));
});
for (const [index, size] of sizes.entries()) {
  test(`retains bounded bulk selection and locked cleanup at ${String(size)} accounts`, async () => {
    const entry = corpora[index];
    if (entry === undefined) throw new Error("Missing corpus");
    const renewal = await entry.observer.measure(() =>
      dueRenewals(entry.observer.prisma, now, size),
    );
    expect(renewal.result).toHaveLength(size);
    expect(renewal.statements).toHaveLength(1);
    const cleanup = await entry.observer.measure(() =>
      closeLapsedSubscriptions(entry.observer.prisma, now, size),
    );
    expect(cleanup.result).toBe(size);
    const states = await entry.database.prisma.billingSubscription.findMany({
      orderBy: { id: "asc" },
      select: { state: true },
    });
    expect(states.slice(0, size).every((row) => row.state === "ended")).toBe(
      true,
    );
    expect(
      states.slice(size, 2 * size).every((row) => row.state === "active"),
    ).toBe(true);
    expect(states[2 * size]?.state).toBe("canceled");
    expect(
      await entry.database.prisma.billingPurchase.findUniqueOrThrow({
        where: { id: id(705, 1) },
      }),
    ).toMatchObject({ state: "unknown" });
    expect(
      await entry.database.prisma.billingSubscriptionEvent.count({
        where: { kind: "subscription_ended" },
      }),
    ).toBe(size);
    expect(
      await entry.database.prisma.billingNotice.count({
        where: { kind: "access_expired" },
      }),
    ).toBe(size);
    expect(await entry.database.prisma.billingNoticeRevision.count()).toBe(
      size,
    );
    const locks = cleanup.statements.filter((sql) =>
      sql.includes("pg_advisory_xact_lock"),
    );
    expect(locks).toHaveLength(2 * size);
    const again = await entry.observer.measure(() =>
      closeLapsedSubscriptions(entry.observer.prisma, now, size),
    );
    expect(again.result).toBe(0);
    expect(again.statements).toHaveLength(1);
    const count = (verb: string) =>
      cleanup.statements.filter((sql) => sql.trimStart().startsWith(verb))
        .length;
    process.stdout.write(
      `${JSON.stringify({ record: "BC-6", fixture: size, ownerCalls: { dueRenewals: 1, closeLapsedSubscriptions: 1 }, providerRequests: 0, dueSelectionStatements: renewal.statements.length, cleanupStatements: cleanup.statements.length, cleanupSqlVerbs: { select: count("SELECT"), update: count("UPDATE"), insert: count("INSERT"), begin: count("BEGIN"), commit: count("COMMIT") }, advisoryLocks: locks.length, closed: cleanup.result, unknownAttemptRetained: true, duplicateAccountCandidates: false })}\n`,
    );
    expect(cleanup.statements).toHaveLength(18 * size + 1);
  });
}

test("stale cleanup eligibility is re-read under locks before ending a renewed schedule", async () => {
  const entry = corpora[3];
  if (entry === undefined) throw new Error("Missing race corpus");
  const original = entry.observer.prisma.$transaction.bind(
    entry.observer.prisma,
  );
  const injection = vi
    .spyOn(entry.observer.prisma, "$transaction")
    .mockImplementation(async (callback, options) => {
      await entry.database.prisma.$transaction(async (tx) => {
        await lockBillingPricing(tx);
        await lockBillingSubscription(tx, id(703, 1));
        const row = await tx.billingSubscription.findUniqueOrThrow({
          where: { id: id(703, 1) },
        });
        await advanceSubscription(
          tx,
          row,
          {
            state: "active",
            bindingRef: id(704, 1),
            bindingCiphertext: "synthetic-encrypted-binding",
          },
          "renewal_resumed",
          {},
          now,
        );
      });
      return original(callback, options);
    });
  try {
    const result = await entry.observer.measure(() =>
      closeLapsedSubscriptions(entry.observer.prisma, now, 1),
    );
    expect(result.result).toBe(0);
    expect(
      result.statements.filter((sql) => sql.includes("pg_advisory_xact_lock")),
    ).toHaveLength(2);
    expect(
      await entry.database.prisma.billingSubscription.findUniqueOrThrow({
        where: { id: id(703, 1) },
      }),
    ).toMatchObject({ state: "active", bindingRef: id(704, 1) });
    expect(
      await entry.database.prisma.billingSubscriptionEvent.count({
        where: { kind: "subscription_ended" },
      }),
    ).toBe(0);
    expect(await entry.database.prisma.billingNotice.count()).toBe(0);
  } finally {
    injection.mockRestore();
  }
});
