import { afterAll, beforeAll, expect, test } from "vitest";
import { seedLocalDevelopment } from "../../src/development/seed-local-development.js";
import { accountId } from "../../src/modules/accounts/index.js";
import {
  anonymousSubject,
  assembleContentAccess,
  assembleDeterministicAccountRights,
} from "../../src/modules/content-access/index.js";
import { listPublishedMaterials } from "../../src/modules/content-library/index.js";
import { assembleMaterials } from "../../src/entrypoints/composition/assemble-materials.js";
import { assembleMaterialResourceFacts } from "../../src/modules/materials/index.js";
import { emptyCatalogVideos } from "../support/catalog-videos.js";
import {
  createTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

import { Prisma } from "../../src/infrastructure/prisma/index.js";
import { migrateThrough, upgradeToLatest } from "./setup/historical-upgrade.js";

let database: TestDatabase;
beforeAll(async () => {
  database = await createTestDatabase();
  await migrateThrough(database, "0112_canonical_product_storage");
  await seedLocalDevelopment(database.prisma, { demo: "published" });
  await database.prisma.$executeRaw(
    Prisma.sql`update materials.materials set show_in_feed=false`,
  );
  await database.prisma.$executeRaw(
    Prisma.sql`update materials.materials set show_in_feed=true where slug in ('kak-ustroen-inside-platform','developer-pipeline-bez-poteri-konteksta')`,
  );
  await upgradeToLatest(database);
});
afterAll(async () => {
  await database.dispose();
});

for (const subject of [
  anonymousSubject,
  {
    kind: "account" as const,
    accountId: accountId("74000000-0000-4000-8000-000000000001"),
  },
]) {
  test(`home feed excludes paid materials for ${subject.kind} while discovery preserves them`, async () => {
    const materials = assembleMaterials({
      prisma: database.prisma,
      authorPolicy: { canManage: () => false },
    });
    const membership = assembleDeterministicAccountRights(
      new Map([
        [
          accountId("74000000-0000-4000-8000-000000000001"),
          { kind: "active" as const, validUntil: null },
        ],
      ]),
    );
    const access = assembleContentAccess({
      materialResourceFacts: assembleMaterialResourceFacts(
        materials.materialContent,
      ),
      accountPermissions: { hasMaterialsManage: () => Promise.resolve(false) },
      accountRights: membership,
    });
    const freeCount = await database.prisma.publishedMaterial.count({
      where: { access: "free" },
    });
    const feed = await listPublishedMaterials(
      materials.publishedMaterialReader,
      access,
      emptyCatalogVideos,
      { subject, feedOnly: true, first: 1 },
    );
    expect(feed).toMatchObject({
      ok: true,
      value: {
        items: [
          expect.objectContaining({
            slug: "kak-ustroen-inside-platform",
            access: "free",
          }),
        ],
        totalCount: freeCount,
      },
    });
    for (const query of [
      {},
      { q: "Developer Pipeline" },
      { topicSlugs: ["platform"] },
      { productSlugs: ["platform-inside"] },
    ]) {
      const discovery = await listPublishedMaterials(
        materials.publishedMaterialReader,
        access,
        emptyCatalogVideos,
        { subject, first: 24, ...query },
      );
      if (!discovery.ok) throw new Error(discovery.error.code);
      expect(discovery.value.items).toContainEqual(
        expect.objectContaining({
          slug: "developer-pipeline-bez-poteri-konteksta",
          access: "closed",
          availability: subject.kind === "anonymous" ? "locked" : "available",
        }),
      );
    }
  });
}
