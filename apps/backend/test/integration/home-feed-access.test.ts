import { Pool } from "pg";
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
import { statement as explicitFeedStatement } from "../../src/modules/materials/infrastructure/postgres/migrations/0115-explicit-feed.js";
import { emptyCatalogVideos } from "../support/catalog-videos.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

let database: TestDatabase;
beforeAll(async () => {
  database = await createMigratedTestDatabase();
  await seedLocalDevelopment(database.prisma, { demo: "published" });
  // Засев пишет текущей схемой, поэтому состояние до 0115 восстанавливается снятием столбцов.
  const pool = new Pool({ connectionString: database.url, max: 1 });
  try {
    await pool.query(
      "alter table materials.materials drop column in_feed; alter table materials.published_materials drop column in_feed",
    );
    await pool.query(explicitFeedStatement);
  } finally {
    await pool.end();
  }
});
afterAll(async () => {
  await database.dispose();
});

test("migration keeps free Materials outside Products in the feed and leaves Product lessons out", async () => {
  const lessons = await database.prisma.productMembership.findMany({
    select: { materialId: true },
  });
  const lessonIds = lessons.map(({ materialId }) => materialId);
  const freeLessons = await database.prisma.publishedMaterial.count({
    where: { access: "free", materialId: { in: lessonIds } },
  });
  // Засев содержит бесплатные уроки курса: без них проверка ничего бы не доказала.
  expect(freeLessons).toBeGreaterThan(0);
  const outsideProducts = await database.prisma.publishedMaterial.count({
    where: { access: "free", materialId: { notIn: lessonIds } },
  });
  expect(
    await database.prisma.publishedMaterial.count({ where: { inFeed: true } }),
  ).toBe(outsideProducts);
  expect(
    await database.prisma.material.count({
      where: { inFeed: true, id: { in: lessonIds } },
    }),
  ).toBe(0);
  expect(
    await database.prisma.material.count({
      where: { inFeed: true, publicationState: { not: "published" } },
    }),
  ).toBe(0);
});

for (const subject of [
  anonymousSubject,
  {
    kind: "account" as const,
    accountId: accountId("74000000-0000-4000-8000-000000000001"),
  },
]) {
  test(`home feed excludes paid materials and Product lessons for ${subject.kind} while discovery preserves them`, async () => {
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
    const feedCount = await database.prisma.publishedMaterial.count({
      where: { inFeed: true },
    });
    const feed = await listPublishedMaterials(
      materials.publishedMaterialReader,
      access,
      emptyCatalogVideos,
      { subject, feedOnly: true, first: 24 },
    );
    if (!feed.ok) throw new Error(feed.error.code);
    expect(feed.value.totalCount).toBe(feedCount);
    expect(feed.value.items.length).toBeGreaterThan(0);
    for (const item of feed.value.items) {
      expect(item).toMatchObject({ access: "free", availability: "available" });
    }
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
