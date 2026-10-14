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
import { CoverageCatalog } from "../../src/modules/materials/facets/coverage-catalog/coverage-catalog.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";
import { createQueryEventClient } from "./setup/query-events.js";

describe.each([1, 10, 100])(
  "Enrollment view workload: %i enrollments",
  (size) => {
    let db: TestDatabase | undefined;
    let measured: ReturnType<typeof createQueryEventClient> | undefined;
    let grants: AccessGrants;
    let owner: string;
    let accountId: string;
    let ids: string[];
    beforeAll(async () => {
      db = await createMigratedTestDatabase();
      measured = createQueryEventClient(db.url);
      const now = new Date("2030-01-01T00:00:00.000Z");
      const end = "2030-02-01T00:00:00.000Z";
      accountId = randomUUID();
      owner = (
        await bootstrapOwnerAccount(
          db.prisma,
          { issuer: "https://enrollment-sets.test", subject: "owner" },
          "platform:admin",
        )
      ).accountId;
      await db.prisma.account.create({
        data: {
          id: accountId,
          logtoIssuer: "https://enrollment-sets.test",
          logtoSubject: accountId,
        },
      });
      const productId = randomUUID();
      const tier = {
        id: randomUUID(),
        revision: 1,
        name: "Shared coverage",
        benefits: ["materials"],
        coverage: { productIds: [productId], materialIds: [] },
      };
      ids = Array.from({ length: size }, () => randomUUID()).sort();
      await db.prisma.tariffAssignment.createMany({
        data: ids.map((id, index) => ({
          id,
          accountId,
          tierId: tier.id,
          tierRevision: 1,
          snapshot: tier,
          origin: index % 2 === 0 ? "tribute" : "manual",
          sourceRef: id,
          startsAt: now,
          endsAt: index % 2 === 0 ? new Date(end) : null,
          endPolicy: index % 2 === 0 ? "temporary_membership" : "fixed",
          revision: 1,
          reason: "Fixture enrollment",
        })),
      });
      const grantIds = ids.map(() => randomUUID());
      await db.prisma.accessGrant.createMany({
        data: ids.map((enrollmentId, index) => ({
          id: grantIds[index] ?? randomUUID(),
          accountId,
          enrollmentId,
          source: "manual",
          sourceRef: enrollmentId,
          capabilities: ["materials"],
          coverage: tier.coverage,
          startsAt: now,
          validUntil: new Date(end),
          revision: 1,
          reason: "Fixture grant",
        })),
      });
      await db.prisma.sourceEntitlement.createMany({
        data: ids
          .filter((_, index) => index % 2 === 0)
          .map((enrollmentId, sourceIndex) => ({
            id: randomUUID(),
            origin: "tribute",
            sourceRef: enrollmentId,
            sourcePolicyRef: "fixture",
            identityRef: enrollmentId,
            accountId,
            enrollmentId,
            revision: 1,
            evidence: {},
            checkedAt: now,
            tributeState: {
              subscriptionId: sourceIndex + 1,
              telegramUserId: "1",
              verificationRef: "fixture",
              mode: "temporary_membership",
              startsAt: now.toISOString(),
              endsAt: end,
              renewal: "stopped",
              tier,
              policyRevision: 1,
              observation: "source_ended",
              observedUntil: null,
              observationVersion: null,
              lastEventAt: null,
              lastEventFingerprint: null,
            },
          })),
      });
      await db.prisma.accessChange.createMany({
        data: grantIds.flatMap((grantId) =>
          Array.from({ length: 101 }, (_, index) => ({
            accountId,
            grantId,
            operationId: randomUUID(),
            kind: "fixture",
            reason: `History ${index + 1}`,
            recordedAt: now,
          })),
        ),
      });
      const accounts = assembleAccounts({
        prisma: measured.prisma,
        emailFingerprintKey: "enrollment-set-view-fixture-fingerprint-key",
      });
      grants = assembleAccessGrants({
        prisma: measured.prisma,
        accounts,
        clock: () => now,
        contentCatalog: new CoverageCatalog(measured.prisma),
      });
    }, 30_000);
    afterAll(async () => {
      await measured?.prisma.$disconnect();
      await db?.dispose();
    });
    test("own views preserve Tribute state, shared coverage and exact order with bounded SQL", async () => {
      if (measured === undefined) throw new Error("Missing measured fixture");
      const read = await measured.measure(() =>
        grants.readOwnEnrollments(accountId),
      );
      expect(read.result.ok).toBe(true);
      if (!read.result.ok) return;
      expect(read.result.value.map((view) => view.id)).toEqual(ids);
      expect(read.result.value.map((view) => view.state)).toEqual(
        ids.map((_, index) =>
          index % 2 === 0 ? "suspended_source" : "active",
        ),
      );
      expect(
        read.result.value.every(
          (view) =>
            view.benefitTerms.length === 1 && view.content?.length === 1,
        ),
      ).toBe(true);
      expect(
        read.statements.filter((sql) => sql.trimStart().startsWith("SELECT"))
          .length,
      ).toBe(4);
    });
    test("owner history retains the latest100 per Enrollment without a global100 cap", async () => {
      if (measured === undefined) throw new Error("Missing measured fixture");
      const read = await measured.measure(() =>
        grants.listEnrollments(owner, accountId),
      );
      expect(read.result.ok).toBe(true);
      if (!read.result.ok) return;
      expect(read.result.value.map((view) => view.id)).toEqual(ids);
      for (const view of read.result.value)
        expect(view.history?.map((entry) => entry.reason)).toEqual(
          Array.from({ length: 100 }, (_, index) => `History ${101 - index}`),
        );
      const ownerFacts = read.statements.filter(
        (sql) =>
          sql.includes('"account_rights"') ||
          sql.includes("account_rights.") ||
          sql.includes("materials."),
      );
      expect(
        ownerFacts.filter(
          (sql) =>
            sql.trimStart().startsWith("SELECT") ||
            sql.trimStart().startsWith("SELECT"),
        ).length,
      ).toBe(5);
    });
  },
);
