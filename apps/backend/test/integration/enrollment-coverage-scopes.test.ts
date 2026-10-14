import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, test } from "vitest";
import { assembleAccounts } from "../../src/modules/accounts/index.js";
import {
  assembleAccessGrants,
  type AccessGrants,
} from "../../src/modules/account-rights/index.js";
import { CoverageCatalog } from "../../src/modules/materials/facets/coverage-catalog/coverage-catalog.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

describe("Enrollment metadata preserves independent whole-platform and archived references", () => {
  let db: TestDatabase | undefined;
  let catalog: CoverageCatalog;
  let grants: AccessGrants;
  let accountId: string;
  let live: string;
  let archived: string;
  let foreignArchived: string;
  let enrollmentIds: string[];
  const fixed = new Date("2030-01-01T00:00:00.000Z");
  beforeAll(async () => {
    db = await createMigratedTestDatabase();
    accountId = randomUUID();
    live = randomUUID();
    archived = randomUUID();
    foreignArchived = randomUUID();
    await db.prisma.account.create({
      data: {
        id: accountId,
        logtoIssuer: "https://coverage-scopes.test",
        logtoSubject: accountId,
      },
    });
    await db.prisma.product.createMany({
      data: [live, archived, foreignArchived].map((id, index) => ({
        id,
        slug: `fixture-${index}`,
        name: `Product ${index}`,
        archivedAt: index === 0 ? null : fixed,
      })),
    });
    enrollmentIds = [randomUUID(), randomUUID(), randomUUID()].sort();
    await db.prisma.tariffAssignment.createMany({
      data: enrollmentIds.map((id, index) => {
        const tierId = randomUUID();
        return {
          id,
          accountId,
          tierId,
          tierRevision: 1,
          snapshot: {
            id: tierId,
            revision: 1,
            name: "Whole platform",
            benefits: ["materials"],
            coverage:
              index === 0
                ? { wholePlatform: true, productIds: [], materialIds: [] }
                : {
                    productIds: [index === 1 ? archived : foreignArchived],
                    materialIds: [],
                  },
          },
          origin: "manual",
          sourceRef: id,
          startsAt: fixed,
          endPolicy: "fixed",
          revision: 1,
          reason: "Coverage fixture",
        };
      }),
    });
    catalog = new CoverageCatalog(db.prisma);
    const accounts = assembleAccounts({
      prisma: db.prisma,
      emailFingerprintKey: "coverage-scope-fixture-fingerprint-key",
    });
    grants = assembleAccessGrants({
      prisma: db.prisma,
      accounts,
      clock: () => fixed,
      contentCatalog: catalog,
    });
  }, 30_000);
  afterAll(async () => db?.dispose());
  test("single and set resolution retain explicit archived Products without neighboring scope leakage", async () => {
    const scopes = [
      { wholePlatform: true, productIds: [], materialIds: [] },
      ...[archived, foreignArchived].map((id) => ({
        productIds: [id],
        materialIds: [],
      })),
    ];
    const resolved = await catalog.resolveMany(scopes);
    for (const [index, scope] of scopes.entries()) {
      expect(resolved[index]).toEqual(await catalog.resolve(scope));
      expect(
        resolved[index]?.map((entry) => [entry.id, entry.available]),
      ).toEqual(index === 0 ? [[live, true]] : [[scope.productIds[0], false]]);
    }
  });
  test("whole-platform scope rejects explicit references through its existing owning contract", async () => {
    const invalid = {
      wholePlatform: true,
      productIds: [archived],
      materialIds: [],
    };
    await expect(catalog.resolve(invalid)).rejects.toThrow();
    await expect(catalog.resolveMany([invalid])).rejects.toThrow();
  });
  test("Enrollment contents retain independent live and archived references", async () => {
    const read = await grants.readOwnEnrollments(accountId);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.value.map((view) => view.id)).toEqual(enrollmentIds);
    for (const [index, view] of read.value.entries()) {
      const explicit = index === 1 ? archived : foreignArchived;
      expect(view.content?.map((entry) => [entry.id, entry.available])).toEqual(
        index === 0 ? [[live, true]] : [[explicit, false]],
      );
    }
  });
});
