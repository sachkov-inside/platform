import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
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
import { createQueryEventClient } from "./setup/query-events.js";

describe("metadata capacity preserves canonical references and complete Enrollment views", () => {
  let db: TestDatabase;
  let observer: ReturnType<typeof createQueryEventClient>;
  let catalog: CoverageCatalog;
  let grants: AccessGrants;
  let products: string[];
  let enrollments: string[];
  const account = randomUUID();
  const now = new Date("2030-01-01T00:00:00.000Z");
  beforeAll(async () => {
    db = await createMigratedTestDatabase();
    observer = createQueryEventClient(db.url);
    catalog = new CoverageCatalog(observer.prisma);
    products = Array.from({ length: 2500 }, () => randomUUID());
    await db.prisma.product.createMany({
      data: products.map((id) => ({ id, name: `Product ${id}`, slug: id })),
    });
    await db.prisma.account.create({
      data: {
        id: account,
        logtoIssuer: "https://capacity.test",
        logtoSubject: account,
      },
    });
    enrollments = Array.from({ length: 5 }, () => randomUUID()).sort();
    await db.prisma.tariffAssignment.createMany({
      data: enrollments.map((id, index) => {
        const tierId = randomUUID();
        return {
          id,
          accountId: account,
          tierId,
          tierRevision: 1,
          snapshot: {
            id: tierId,
            revision: 1,
            name: "Scoped fixture",
            benefits: ["materials"],
            coverage: {
              productIds: products.slice(index * 500, (index + 1) * 500),
              materialIds: [],
            },
          },
          origin: "manual",
          sourceRef: id,
          startsAt: now,
          endPolicy: "fixed",
          revision: 1,
          reason: "Capacity parity fixture",
        };
      }),
    });
    grants = assembleAccessGrants({
      prisma: observer.prisma,
      accounts: assembleAccounts({
        prisma: db.prisma,
        emailFingerprintKey: "catalog-capacity-test-fingerprint-key",
      }),
      clock: () => now,
      contentCatalog: catalog,
    });
  });
  afterAll(async () => {
    await observer.prisma.$disconnect();
    await db.dispose();
  });
  test("1001 uppercase UUID references count once against the 2000-entry boundary", async () => {
    const ids = products.slice(0, 1001).map((id) => id.toUpperCase());
    const read = await observer.measure(() =>
      catalog.resolveMany([
        { productIds: ids.slice(0, 1000), materialIds: [] },
        { productIds: ids.slice(1000), materialIds: [] },
      ]),
    );
    expect(read.result.flat().map((entry) => entry.id)).toEqual(
      products.slice(0, 1001),
    );
    expect(read.result.flat().every((entry) => entry.available)).toBe(true);
    expect(
      read.statements.filter((sql) => sql.includes("FROM materials.series")),
    ).toHaveLength(1);
  });
  test("five individually supported scopes keep all Enrollment metadata in its original order", async () => {
    const scopes = enrollments.map((_, index) => ({
      productIds: products.slice(index * 500, (index + 1) * 500),
      materialIds: [],
    }));
    for (const scope of scopes)
      expect(await catalog.resolve(scope)).toHaveLength(500);
    await expect(catalog.resolveMany(scopes)).rejects.toThrow(
      "Content scope catalog exceeds supported size",
    );
    const read = await observer.measure(() =>
      grants.readOwnEnrollments(account),
    );
    expect(read.result.ok).toBe(true);
    if (!read.result.ok) return;
    expect(read.result.value.map((view) => view.id)).toEqual(enrollments);
    for (const [index, view] of read.result.value.entries())
      expect(view.content?.map((entry) => entry.id)).toEqual(
        scopes[index]?.productIds,
      );
    expect(
      read.statements.filter((sql) => sql.includes("FROM materials.series")),
    ).toHaveLength(2);
  });
});
