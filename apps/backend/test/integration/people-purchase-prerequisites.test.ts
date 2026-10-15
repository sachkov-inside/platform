import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, test } from "vitest";
import {
  assembleAccounts,
  bootstrapOwnerAccount,
} from "../../src/modules/accounts/index.js";
import { assembleAccessGrants } from "../../src/modules/account-rights/index.js";
import { BillingOperations } from "../../src/modules/billing/index.js";
import { TelegramAccountLinks } from "../../src/modules/telegram-membership/index.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";
import { createQueryRowClient } from "./setup/query-rows.js";

const unused = () =>
  Promise.reject(new Error("Unexpected provider/catalog call in People read"));
describe.each([0, 1000, 10000])(
  "People Offer prerequisites with %i unrelated confirmed purchases",
  (historySize) => {
    let db: TestDatabase;
    let observer: ReturnType<typeof createQueryRowClient>;
    let operations: BillingOperations;
    let owner: string;
    let activeIds: string[];
    const offerId = randomUUID();
    const now = new Date("2030-01-01T00:00:00.000Z");
    beforeAll(async () => {
      db = await createMigratedTestDatabase();
      observer = createQueryRowClient(db.url);
      owner = (
        await bootstrapOwnerAccount(
          db.prisma,
          { issuer: "https://purchase-rows.test", subject: "owner" },
          "platform:admin",
        )
      ).accountId;
      activeIds = Array.from({ length: 10 }, () => randomUUID()).sort();
      const extraIds = Array.from({ length: 4 }, () => randomUUID());
      const historyAccount = randomUUID();
      await db.prisma.account.createMany({
        data: [...activeIds, ...extraIds, historyAccount].map((id) => ({
          id,
          logtoIssuer: "https://purchase-rows.test",
          logtoSubject: id,
        })),
      });
      const purchaseIds = Array.from({ length: 14 + historySize }, () =>
        randomUUID(),
      );
      const snapshot = (id: string) => ({
        offer: {
          id,
          revision: 1,
          name: "Controlled Product",
          benefits: ["community"],
          archived: false,
        },
        paymentOption: {
          id: randomUUID(),
          revision: 1,
          offerId: id,
          months: 1,
          priceKopecks: 1000,
          archived: false,
        },
        promotion: null,
        currency: "RUB",
        timezone: "Europe/Moscow",
        firstPriceKopecks: 1000,
        renewalPriceKopecks: 1000,
        communityPolicy: "explicit",
      });
      const snapshots = purchaseIds.map((_, index) =>
        snapshot(index === 12 ? randomUUID() : offerId),
      );
      const quoteIds = purchaseIds.map(() => randomUUID());
      await db.prisma.billingPriceQuote.createMany({
        data: purchaseIds.map((_, index) => ({
          id: quoteIds[index] ?? randomUUID(),
          accountId: activeIds[index] ?? extraIds[index - 10] ?? historyAccount,
          operationId: randomUUID(),
          fingerprint: "Controlled purchase fixture",
          snapshot: snapshots[index] ?? {},
          createdAt: now,
          expiresAt: new Date("2030-01-02T00:00:00.000Z"),
        })),
      });
      await db.prisma.billingPurchase.createMany({
        data: purchaseIds.map((id, index) => ({
          id,
          quoteRef: quoteIds[index] ?? randomUUID(),
          accountId: activeIds[index] ?? extraIds[index - 10] ?? historyAccount,
          state: index === 10 ? "failed" : "confirmed",
          paymentId: index === 10 ? null : randomUUID(),
          confirmedAt: index === 10 ? null : now,
          periodEndsAt:
            index === 11 ? new Date("2030-02-01T00:00:00.000Z") : null,
          kind: index === 11 ? "initial" : "one_time",
          lifecycleActive: false,
          environment: "demo",
          terminalRef: "SYNTHETICPEOPLE",
          amountKopecks: 1000n,
          snapshot: snapshots[index] ?? {},
          acceptance: {},
          contact: {},
          fiscalization: "pending",
          createdAt: new Date("2000-01-01T00:00:00.000Z"),
          updatedAt: now,
        })),
      });
      await db.prisma.accessGrant.createMany({
        data: [...activeIds, ...extraIds].map((accountId, index) => ({
          id: randomUUID(),
          accountId,
          source: "paid",
          sourceRef:
            index === 13
              ? (purchaseIds[index] ?? "")
              : `${purchaseIds[index]}:materials`,
          capabilities: ["community"],
          startsAt: now,
          validUntil: null,
          revision: 1,
          reason: "Controlled People source prefix",
        })),
      });
      const accounts = assembleAccounts({
        prisma: observer.prisma,
        emailFingerprintKey: "people-purchase-corpus-fingerprint-key",
      });
      const grants = assembleAccessGrants({
        prisma: observer.prisma,
        accounts,
        clock: () => now,
        recipientLinks: new TelegramAccountLinks(observer.prisma),
      });
      operations = new BillingOperations({
        prisma: observer.prisma,
        accounts,
        grants,
        pricing: { manage: unused, ownerCatalog: unused },
        payments: { reconcile: unused },
        subscriptions: { cancel: unused },
        bank: undefined,
        clock: () => now,
      });
    });
    afterAll(async () => {
      await observer.prisma.$disconnect();
      await db.dispose();
    });
    test("the same Offer-filtered page reads only candidate purchase facts and preserves kind/state/prefix", async () => {
      const read = await observer.measure(() =>
        operations.execute(owner, {
          operation: "people.list",
          operationId: randomUUID(),
          offerId,
          source: "one_time_purchase",
          state: "active",
          limit: 100,
        }),
      );
      const returnedRows = read.rows.reduce(
        (sum, query) => sum + query.count,
        0,
      );
      const purchaseRows = read.rows
        .filter((query) => query.statement.includes('"billing"."purchases"'))
        .reduce((sum, query) => sum + query.count, 0);
      process.stdout.write(
        `${JSON.stringify({ record: "PAG-08", unrelatedPurchases: historySize, activeAccounts: 10, returnedRows, purchaseRows, returnedBytes: read.rows.reduce((sum, row) => sum + row.serializedBytes, 0), elapsedMs: read.elapsedMs, processCpu: read.processCpu, ownerCalls: 1, sqlStatements: read.statements.length, providerRequests: 0 })}\n`,
      );
      expect(read.result.ok).toBe(true);
      if (!read.result.ok || read.result.result.outcome !== "people") return;
      expect(read.result.result.items.map((item) => item.accountId)).toEqual(
        activeIds,
      );
      expect(read.result.result.nextCursor).toBeNull();
      expect(returnedRows).toBeGreaterThan(20);
      expect(returnedRows).toBeLessThanOrEqual(100);
      expect(purchaseRows).toBeGreaterThanOrEqual(20);
      expect(purchaseRows).toBeLessThanOrEqual(25);
    });
  },
);
