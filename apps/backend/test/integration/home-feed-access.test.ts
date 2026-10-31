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
import { representativeDocument } from "../fixtures/material-body/representative.js";
import { emptyCatalogVideos } from "../support/catalog-videos.js";
import {
  createTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

import { Prisma } from "../../src/infrastructure/prisma/index.js";
import { migrateThrough, upgradeToLatest } from "./setup/historical-upgrade.js";

// The frozen 0112 schema has every prior scalar field, but no 0115 inFeed column.
const historicalPublicationProjection = {
  materialId: true,
  contentVersion: true,
  slug: true,
  title: true,
  summary: true,
  difficulty: true,
  outcomes: true,
  hasModeVariants: true,
  access: true,
  topicId: true,
  formatId: true,
  publicSearchText: true,
  publishedBy: true,
  publishedAt: true,
  primaryVideoId: true,
  coverId: true,
} satisfies Prisma.PublishedMaterialSelect;

let database: TestDatabase;
beforeAll(async () => {
  database = await createTestDatabase();
  await migrateThrough(database, "0112_canonical_product_storage");
  // #1745: these frozen 0112 rows precede the current writer and its outbox schema.
  // Distinct source IDs/slugs keep the current seed from overwriting the upgrade evidence.
  const topicId = "74000000-0000-4000-8000-000000000010";
  const actor = "74000000-0000-4000-8000-000000000011";
  const publishedAt = new Date("2020-01-01T00:00:00Z");
  await database.prisma.topic.create({
    data: { id: topicId, slug: "historical-feed", name: "Historical feed" },
  });
  for (const [id, access, showInFeed] of [
    ["74000000-0000-4000-8000-000000000012", "free", false],
    ["74000000-0000-4000-8000-000000000013", "closed", true],
  ] as const) {
    const slug = `historical-feed-${access}`;
    await database.prisma.$executeRaw(Prisma.sql`
      insert into materials.materials (
        id, slug, title, summary, topic_id, format_id, schema_version, body,
        created_by, access, publication_state, content_version,
        first_published_at, published_at, published_by,
        source_id, source_path, source_revision, show_in_feed
      ) values (
        ${id}::uuid, ${slug}, ${slug}, '', ${topicId}::uuid, 'note', 1,
        ${JSON.stringify(representativeDocument(slug).doc)}::jsonb,
        ${actor}::uuid, ${access}, 'published', 1,
        ${publishedAt}, ${publishedAt}, ${actor}::uuid,
        ${slug}, ${`${slug}.md`}, ${"a".repeat(64)}, ${showInFeed}
      )
    `);
    await database.prisma.$executeRaw(Prisma.sql`
      insert into materials.published_materials (
        material_id, content_version, slug, title, summary, access, topic_id,
        format_id, public_search_text, published_by, published_at
      ) values (
        ${id}::uuid, 1, ${slug}, ${slug}, '', ${access}, ${topicId}::uuid,
        'note', ${slug}, ${actor}::uuid, ${publishedAt}
      )
    `);
  }
  const before = await database.prisma.publishedMaterial.findMany({
    select: historicalPublicationProjection,
    orderBy: { materialId: "asc" },
  });
  await upgradeToLatest(database);
  expect(
    await database.prisma.publishedMaterial.findMany({
      select: historicalPublicationProjection,
      orderBy: { materialId: "asc" },
    }),
  ).toEqual(before);
  expect(
    await database.prisma.$queryRaw(Prisma.sql`
    select original->>'id' as id, original->'showInFeed' as flag
    from materials.historical_source_records order by material_id
  `),
  ).toEqual([
    { id: "historical-feed-free", flag: false },
    { id: "historical-feed-closed", flag: true },
  ]);
  expect(
    await database.prisma.$queryRaw(Prisma.sql`
    select column_name from information_schema.columns
    where table_schema='materials' and table_name='materials'
      and column_name='show_in_feed'
  `),
  ).toEqual([]);
  // Prove retired flags do not control the upgraded feed before any current seed writes.
  const { materials, access } = contentDependencies();
  expect(
    await listPublishedMaterials(
      materials.publishedMaterialReader,
      access,
      emptyCatalogVideos,
      { subject: anonymousSubject, feedOnly: true, first: 24 },
    ),
  ).toMatchObject({
    ok: true,
    value: {
      totalCount: 1,
      items: [
        expect.objectContaining({
          slug: "historical-feed-free",
          access: "free",
        }),
      ],
    },
  });
  const historicalDiscovery = await listPublishedMaterials(
    materials.publishedMaterialReader,
    access,
    emptyCatalogVideos,
    { subject: anonymousSubject, first: 24 },
  );
  if (!historicalDiscovery.ok) throw new Error(historicalDiscovery.error.code);
  expect(historicalDiscovery.value.totalCount).toBe(2);
  expect(historicalDiscovery.value.items).toContainEqual(
    expect.objectContaining({
      slug: "historical-feed-closed",
      access: "closed",
      availability: "locked",
    }),
  );
  await seedLocalDevelopment(database.prisma, { demo: "published" });
  expect(
    await database.prisma.publishedMaterial.findMany({
      select: historicalPublicationProjection,
      where: { materialId: { in: before.map((row) => row.materialId) } },
      orderBy: { materialId: "asc" },
    }),
  ).toEqual(before);
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
  expect(
    await database.prisma.publishedMaterial.findMany({
      select: historicalPublicationProjection,
      where: { materialId: { in: before.map((row) => row.materialId) } },
      orderBy: { materialId: "asc" },
    }),
  ).toEqual(before);
});
afterAll(async () => {
  await database.dispose();
});

function contentDependencies() {
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
  return { materials, access };
}

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
    const { materials, access } = contentDependencies();
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
    expect(feed.value.items).toContainEqual(
      expect.objectContaining({
        slug: "kak-ustroen-inside-platform",
        access: "free",
      }),
    );
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
