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
import { representativeDocument } from "../fixtures/material-body/representative.js";
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
    await database.prisma.publishedMaterial.create({
      data: {
        materialId: id,
        contentVersion: 1n,
        slug,
        title: slug,
        summary: "",
        access,
        topicId,
        formatId: "note",
        publicSearchText: slug,
        publishedBy: actor,
        publishedAt,
      },
    });
  }
  const before = await database.prisma.publishedMaterial.findMany({
    orderBy: { materialId: "asc" },
  });
  await upgradeToLatest(database);
  expect(
    await database.prisma.publishedMaterial.findMany({
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
  expect(
    await listPublishedMaterials(
      materials.publishedMaterialReader,
      access,
      emptyCatalogVideos,
      { subject: anonymousSubject, first: 24 },
    ),
  ).toMatchObject({
    ok: true,
    value: {
      totalCount: 2,
      items: expect.arrayContaining([
        expect.objectContaining({
          slug: "historical-feed-closed",
          access: "closed",
          availability: "locked",
        }),
      ]),
    },
  });
  await seedLocalDevelopment(database.prisma, { demo: "published" });
  expect(
    await database.prisma.publishedMaterial.findMany({
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

for (const subject of [
  anonymousSubject,
  {
    kind: "account" as const,
    accountId: accountId("74000000-0000-4000-8000-000000000001"),
  },
]) {
  test(`home feed excludes paid materials for ${subject.kind} while discovery preserves them`, async () => {
    const { materials, access } = contentDependencies();
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
