import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, test } from "vitest";
import {
  assembleAccounts,
  bootstrapOwnerAccount,
} from "../../src/modules/accounts/index.js";
import {
  assembleAccessGrants,
  type AccessGrants,
} from "../../src/modules/account-rights/index.js";
import { TelegramAccountLinks } from "../../src/modules/telegram-membership/index.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";
import { createQueryRowClient } from "./setup/query-rows.js";

describe.each([0, 1000, 10000])(
  "People prerequisite rows with %i expired Enrollments",
  (historySize) => {
    let db: TestDatabase | undefined;
    let measured: ReturnType<typeof createQueryRowClient> | undefined;
    let grants: AccessGrants;
    let owner: string;
    let activeIds: string[];
    const fixed = new Date("2030-01-01T00:00:00.000Z");
    beforeAll(async () => {
      db = await createMigratedTestDatabase();
      measured = createQueryRowClient(
        db.url,
        historySize === 10000 && process.env["PEOPLE_EXPLAIN"] === "1",
      );
      owner = (
        await bootstrapOwnerAccount(
          db.prisma,
          { issuer: "https://people-rows.test", subject: "owner" },
          "platform:admin",
        )
      ).accountId;
      activeIds = Array.from({ length: 10 }, () => randomUUID()).sort();
      const expiredIds = Array.from({ length: historySize }, () =>
        randomUUID(),
      );
      const ids = [...activeIds, ...expiredIds];
      const tierId = randomUUID();
      const snapshot = {
        id: tierId,
        revision: 1,
        name: "История тарифа",
        benefits: ["materials"],
        benefitPeriods: [{ capability: "materials", months: 1 }],
        coverage: { productIds: [randomUUID()], materialIds: [] },
      };
      await db.prisma.account.createMany({
        data: ids.map((id) => ({
          id,
          logtoIssuer: "https://people-rows.test",
          logtoSubject: id,
        })),
      });
      const enrollmentIds = ids.map(() => randomUUID());
      await db.prisma.tariffAssignment.createMany({
        data: ids.map((accountId, index) => ({
          id: enrollmentIds[index] ?? randomUUID(),
          accountId,
          tierId,
          tierRevision: 1,
          snapshot,
          origin: "manual",
          sourceRef: accountId,
          startsAt: new Date("2000-01-01T00:00:00.000Z"),
          endPolicy: "fixed",
          revision: 1,
          reason: "Fixture history",
        })),
      });
      await db.prisma.accessGrant.createMany({
        data: ids.map((accountId, index) => ({
          id: randomUUID(),
          accountId,
          enrollmentId: enrollmentIds[index] ?? randomUUID(),
          source: "manual",
          sourceRef: accountId,
          capabilities: ["materials"],
          startsAt: new Date("2000-01-01T00:00:00.000Z"),
          validUntil: new Date(
            index < 10
              ? "2030-02-01T00:00:00.000Z"
              : "2001-01-01T00:00:00.000Z",
          ),
          revision: 1,
          reason: "Fixture right",
        })),
      });
      const futureEnrollmentIds = expiredIds.map(() => randomUUID());
      await db.prisma.tariffAssignment.createMany({
        data: expiredIds.map((accountId, index) => ({
          id: futureEnrollmentIds[index] ?? randomUUID(),
          accountId,
          tierId,
          tierRevision: 1,
          snapshot,
          origin: "manual",
          sourceRef: `${accountId}:future-assignment`,
          startsAt: new Date("2030-01-02T00:00:00.000Z"),
          endPolicy: "fixed",
          revision: 1,
          reason: "Scheduled Enrollment retains its existing state",
        })),
      });
      await db.prisma.accessGrant.createMany({
        data: expiredIds.map((accountId, index) => ({
          id: randomUUID(),
          accountId,
          enrollmentId: futureEnrollmentIds[index] ?? randomUUID(),
          source: "manual",
          sourceRef: `${accountId}:historical-benefit`,
          capabilities: ["materials"],
          startsAt: new Date("2000-01-01T00:00:00.000Z"),
          validUntil: new Date("2029-12-31T00:00:00.000Z"),
          revision: 1,
          reason: "Historical benefit of a scheduled Enrollment",
        })),
      });
      const firstAccount = activeIds[0];
      const firstEnrollment = enrollmentIds[0];
      if (firstAccount === undefined || firstEnrollment === undefined)
        throw new Error("Missing fixture Account");
      await db.prisma.accessGrant.createMany({
        data: Array.from({ length: historySize }, (_, index) => ({
          id: randomUUID(),
          accountId: firstAccount,
          enrollmentId: firstEnrollment,
          source: "manual",
          sourceRef: `${firstAccount}:old-term-${index}`,
          capabilities: ["materials"],
          startsAt: new Date("2000-01-01T00:00:00.000Z"),
          validUntil: new Date("2001-01-01T00:00:00.000Z"),
          revision: 1,
          reason: "Historical term of selected Enrollment",
        })),
      });
      const accounts = assembleAccounts({
        prisma: measured.prisma,
        emailFingerprintKey: "people-prerequisite-row-fixture-fingerprint-key",
      });
      grants = assembleAccessGrants({
        prisma: measured.prisma,
        accounts,
        recipientLinks: new TelegramAccountLinks(measured.prisma),
        clock: () => fixed,
      });
    });
    afterAll(async () => {
      await measured?.prisma.$disconnect();
      await db?.dispose();
    });
    test("the same People page does not materialize expired prerequisite snapshots", async () => {
      if (measured === undefined) throw new Error("Missing fixture client");
      const reading = await measured.measure(() =>
        grants.listAccessHolders(
          owner,
          { operationId: randomUUID(), state: "active", limit: 100 },
          { offerPurchaseRefs: [] },
        ),
      );
      const returnedRows = reading.rows.reduce(
        (sum, statement) => sum + statement.count,
        0,
      );
      process.stdout.write(
        `${JSON.stringify({ record: "PAG-08", expiredEnrollments: historySize, activeAccounts: 10, returnedRows, returnedBytes: reading.rows.reduce((sum, row) => sum + row.serializedBytes, 0), elapsedMs: reading.elapsedMs, processCpu: reading.processCpu, ownerCalls: 1, sqlStatements: reading.statements.length, providerRequests: 0 })}\n`,
      );
      expect(reading.result.ok).toBe(true);
      if (!reading.result.ok) return;
      expect(reading.result.value.items.map((item) => item.accountId)).toEqual(
        activeIds,
      );
      expect(reading.result.value.nextCursor).toBeNull();
      if (historySize === 10000 && process.env["PEOPLE_EXPLAIN"] === "1")
        process.stdout.write(
          `${JSON.stringify({ eligibilityPlan: await measured.explainEligibility() })}\n`,
        );
      expect(returnedRows).toBeGreaterThanOrEqual(30);
      expect(returnedRows).toBeLessThanOrEqual(60);
      expect(
        reading.statements.filter(
          (sql) =>
            sql.includes('"telegram_membership"') &&
            sql.trimStart().startsWith("SELECT"),
        ).length,
      ).toBe(1);
    });
    test("an ended page does not hydrate unrelated scheduled Enrollments with recent historical terms", async () => {
      if (measured === undefined) throw new Error("Missing fixture client");
      const read = await measured.measure(() =>
        grants.listAccessHolders(
          owner,
          { operationId: randomUUID(), state: "ended", limit: 100 },
          { offerPurchaseRefs: [] },
        ),
      );
      const returnedRows = read.rows.reduce(
        (sum, query) => sum + query.count,
        0,
      );
      process.stdout.write(
        `${JSON.stringify({ record: "PAG-08", state: "ended", scheduledEnrollments: historySize, returnedRows, returnedBytes: read.rows.reduce((sum, row) => sum + row.serializedBytes, 0), elapsedMs: read.elapsedMs, processCpu: read.processCpu, ownerCalls: 1, sqlStatements: read.statements.length, providerRequests: 0 })}\n`,
      );
      expect(read.result).toMatchObject({
        ok: true,
        value: { items: [], nextCursor: null },
      });
      expect(returnedRows).toBeLessThanOrEqual(10);
    });
  },
);
