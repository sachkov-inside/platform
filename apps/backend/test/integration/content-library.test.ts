import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { seedLocalDevelopment } from "../../src/development/seed-local-development.js";
import { Prisma } from "../../src/infrastructure/prisma/index.js";
import { listPublishedMaterials } from "../../src/modules/content-library/index.js";
import { anonymousSubject } from "../../src/modules/content-access/index.js";
import { assembleMaterials } from "../../src/modules/materials/index.js";
import { selectPublishedMaterialProjectionPage } from "../../src/modules/materials/infrastructure/postgres/published-material-reader/published-material-projection.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

describe("ListPublishedMaterials", () => {
  let testDatabase: TestDatabase;

  beforeAll(async () => {
    testDatabase = await createMigratedTestDatabase();
    await seedLocalDevelopment(testDatabase.prisma);
    await seedSearchFixtures(testDatabase);
  });

  afterAll(async () => {
    await testDatabase.dispose();
  });

  test("continues through deterministic pages of safe published projections", async () => {
    const { contentAccess, publishedMaterialReader } = assembleMaterials({
      prisma: testDatabase.prisma,
      authorPolicy: { canManage: () => false },
    });
    const firstPage = await listPublishedMaterials(
      publishedMaterialReader,
      contentAccess,
      { subject: anonymousSubject, first: 1 },
    );
    expect(firstPage).toMatchObject({
      ok: true,
      value: {
        items: [
          {
            slug: "developer-pipeline-bez-poteri-konteksta",
            title: "Developer Pipeline без потери контекста",
            access: "membership",
          },
        ],
      },
    });
    expect(firstPage.ok && typeof firstPage.value.nextCursor === "string").toBe(true);
    if (!firstPage.ok || firstPage.value.nextCursor === null) {
      throw new Error("Expected the first catalog page to continue");
    }

    const secondPage = await listPublishedMaterials(
      publishedMaterialReader,
      contentAccess,
      {
        subject: anonymousSubject,
        after: firstPage.value.nextCursor,
        first: 1,
      },
    );
    expect(secondPage).toMatchObject({
      ok: true,
      value: {
        items: [
          expect.objectContaining({
            slug: "kak-ustroen-inside-platform",
            title: "Как устроен Inside Platform",
            access: "free",
          }),
        ],
      },
    });
    expect(
      secondPage.ok && typeof secondPage.value.nextCursor === "string",
    ).toBe(true);
    expect(JSON.stringify([firstPage, secondPage])).not.toContain("schemaVersion");
    expect(JSON.stringify([firstPage, secondPage])).not.toContain("blocks");
  });

  test("ranks title, summary and public metadata for RU/EN search", async () => {
    const { contentAccess, publishedMaterialReader } = assembleMaterials({
      prisma: testDatabase.prisma,
      authorPolicy: { canManage: () => false },
    });

    const english = await listPublishedMaterials(
      publishedMaterialReader,
      contentAccess,
      {
        subject: anonymousSubject,
        first: 12,
        q: "career roadmap",
        topicSlugs: [],
        formatSlugs: [],
        seriesSlugs: [],
        sort: "relevance",
      },
    );
    expect(english).toMatchObject({
      ok: true,
      value: {
        items: [
          expect.objectContaining({
            slug: "career-roadmap",
            title: "Career roadmap",
            access: "membership",
          }),
          expect.objectContaining({ slug: "career-roadmap-summary" }),
          expect.objectContaining({ slug: "career-roadmap-taxonomy" }),
        ],
        totalCount: 3,
      },
    });
    if (!english.ok) {
      throw new Error("Expected the English search fixture");
    }
    expect(english.value.facets.topics.map(({ slug }) => slug)).toEqual(
      expect.arrayContaining(["platform", "career"]),
    );
    expect(english.value.facets.formats.map(({ slug }) => slug)).toEqual(
      expect.arrayContaining(["guide", "video"]),
    );
    expect(english.value.facets.series.map(({ slug }) => slug)).toContain(
      "career-path",
    );

    await expect(
      listPublishedMaterials(publishedMaterialReader, contentAccess, {
        subject: anonymousSubject,
        first: 12,
        q: "career roadmap",
        topicSlugs: ["career", "platform"],
        formatSlugs: ["video"],
        seriesSlugs: ["career-path"],
        sort: "relevance",
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        items: [expect.objectContaining({ slug: "career-roadmap" })],
        totalCount: 1,
      },
    });

    const russian = await listPublishedMaterials(
      publishedMaterialReader,
      contentAccess,
      {
        subject: anonymousSubject,
        first: 12,
        q: "карьерный маршрут",
        topicSlugs: [],
        formatSlugs: [],
        seriesSlugs: [],
        sort: "relevance",
      },
    );
    expect(russian).toMatchObject({
      ok: true,
      value: {
        items: [
          expect.objectContaining({
            slug: "karernyi-marshrut",
            title: "Карьерный маршрут инженера",
          }),
          expect.objectContaining({ slug: "karernyi-marshrut-summary" }),
        ],
        totalCount: 2,
      },
    });
    expect(JSON.stringify([english, russian])).not.toContain("schemaVersion");
    expect(JSON.stringify([english, russian])).not.toContain("blocks");
    expect(JSON.stringify([english, russian])).not.toContain(
      "Закрытый карьерный план",
    );
  });

  test("binds stable cursors to the normalized facet and sort state", async () => {
    const { contentAccess, publishedMaterialReader } = assembleMaterials({
      prisma: testDatabase.prisma,
      authorPolicy: { canManage: () => false },
    });
    const firstPage = await listPublishedMaterials(
      publishedMaterialReader,
      contentAccess,
      {
        subject: anonymousSubject,
        first: 1,
        topicSlugs: ["career"],
        sort: "title",
      },
    );
    if (!firstPage.ok || firstPage.value.nextCursor === null) {
      throw new Error("Expected the filtered search page to continue");
    }

    const secondPage = await listPublishedMaterials(
      publishedMaterialReader,
      contentAccess,
      {
        subject: anonymousSubject,
        after: firstPage.value.nextCursor,
        first: 1,
        topicSlugs: ["career"],
        sort: "title",
      },
    );
    expect(secondPage).toMatchObject({
      ok: true,
      value: { items: [expect.any(Object)], totalCount: 2 },
    });
    if (!secondPage.ok) {
      throw new Error("Expected the second filtered search page");
    }
    expect(secondPage.value.items[0]?.slug).not.toBe(
      firstPage.value.items[0]?.slug,
    );

    await expect(
      listPublishedMaterials(publishedMaterialReader, contentAccess, {
        subject: anonymousSubject,
        after: firstPage.value.nextCursor,
        first: 1,
        formatSlugs: ["video"],
        topicSlugs: ["career"],
        sort: "title",
      }),
    ).resolves.toEqual({
      ok: false,
      error: { code: "invalid_request_shape" },
    });
  });

  test(
    "keeps representative PostgreSQL search below the 300ms p95 budget at 10k rows",
    async () => {
      await seedSearchPerformanceCorpus(testDatabase);
      const plan = await testDatabase.prisma.$queryRaw<unknown[]>(Prisma.sql`
        explain (format json)
        select publication.material_id
        from materials.published_materials as publication
        where publication.search_vector @@ (
          websearch_to_tsquery('russian'::regconfig, 'benchmark needle') ||
          websearch_to_tsquery('english'::regconfig, 'benchmark needle') ||
          websearch_to_tsquery('simple'::regconfig, 'benchmark needle')
        )
      `);
      expect(JSON.stringify(plan)).toContain(
        '"Index Name":"published_materials_search_vector_idx"',
      );
      const indexes = await testDatabase.prisma.$queryRaw<
        readonly { readonly indexdef: string }[]
      >(Prisma.sql`
        select indexdef
        from pg_indexes
        where schemaname = 'materials'
          and indexname = 'published_materials_search_vector_idx'
      `);
      expect(indexes).toHaveLength(1);
      expect(indexes[0]?.indexdef).toContain("USING gin");

      const durations: number[] = [];
      for (let sample = 0; sample < 20; sample += 1) {
        const startedAt = performance.now();
        const result = await selectPublishedMaterialProjectionPage(
          testDatabase.prisma,
          {
            formatSlugs: [],
            first: 12,
            q: "benchmark needle",
            seriesSlugs: [],
            sort: "relevance",
            topicSlugs: [],
          },
        );
        durations.push(performance.now() - startedAt);
        expect(result).toMatchObject({
          totalCount: 1,
        });
      }

      const sortedDurations = durations.toSorted((left, right) => left - right);
      const p95 = sortedDurations[Math.ceil(sortedDurations.length * 0.95) - 1];
      expect(p95).toBeDefined();
      expect(p95).toBeLessThanOrEqual(300);
    },
    60_000,
  );
});

const actorId = "74000000-0000-4000-8000-000000000001";
const careerTopicId = "74000000-0000-4000-8000-000000000002";
const videoFormatId = "74000000-0000-4000-8000-000000000003";
const careerSeriesId = "74000000-0000-4000-8000-000000000004";
const careerSearchTagId = "74000000-0000-4000-8000-000000000005";

async function seedSearchFixtures(testDatabase: TestDatabase): Promise<void> {
  await testDatabase.prisma.topic.create({
    data: { id: careerTopicId, name: "Карьера", slug: "career" },
  });
  await testDatabase.prisma.format.create({
    data: { id: videoFormatId, name: "Видео", slug: "video" },
  });
  await testDatabase.prisma.series.create({
    data: {
      id: careerSeriesId,
      name: "Карьерный путь",
      slug: "career-path",
    },
  });
  await testDatabase.prisma.tag.create({
    data: {
      id: careerSearchTagId,
      name: "Career roadmap taxonomy",
      normalizedName: "career roadmap taxonomy",
    },
  });

  const { authoring } = assembleMaterials({
    prisma: testDatabase.prisma,
    authorPolicy: { canManage: (accountId) => accountId === actorId },
  });
  const fixtures = [
    {
      slug: "career-roadmap",
      metadata: {
        title: "Career roadmap",
        summary: "A practical route for engineers.",
        access: "membership" as const,
        topicId: careerTopicId,
        formatId: videoFormatId,
        tagIds: [],
        seriesIds: [careerSeriesId],
      },
      bodyText: "Закрытый карьерный план",
    },
    {
      slug: "career-roadmap-summary",
      metadata: {
        title: "Engineering growth plan",
        summary: "Career roadmap for senior developers.",
        access: "free" as const,
        topicId: "72000000-0000-4000-8000-000000000002",
        formatId: "72000000-0000-4000-8000-000000000003",
        tagIds: [],
        seriesIds: [],
      },
      bodyText: "Summary-weight fixture",
    },
    {
      slug: "career-roadmap-taxonomy",
      metadata: {
        title: "Engineering progression",
        summary: "A practical sequence for developers.",
        access: "free" as const,
        topicId: "72000000-0000-4000-8000-000000000002",
        formatId: "72000000-0000-4000-8000-000000000003",
        tagIds: [careerSearchTagId],
        seriesIds: [],
      },
      bodyText: "Taxonomy-weight fixture",
    },
    {
      slug: "karernyi-marshrut",
      metadata: {
        title: "Карьерный маршрут инженера",
        summary: "Последовательный план для инженеров.",
        access: "free" as const,
        topicId: careerTopicId,
        formatId: "72000000-0000-4000-8000-000000000003",
        tagIds: [],
        seriesIds: [],
      },
      bodyText: "Открытый карьерный план",
    },
    {
      slug: "karernyi-marshrut-summary",
      metadata: {
        title: "Развитие инженера",
        summary: "Карьерный маршрут для технического лидера.",
        access: "free" as const,
        topicId: "72000000-0000-4000-8000-000000000002",
        formatId: "72000000-0000-4000-8000-000000000003",
        tagIds: [],
        seriesIds: [],
      },
      bodyText: "Русский summary-weight fixture",
    },
  ] as const;

  for (const [index, fixture] of fixtures.entries()) {
    const created = await authoring.createDraft({
      actor: actorId,
      idempotencyKey: `74000000-0000-4000-8000-${String(index + 10).padStart(12, "0")}`,
      metadata: fixture.metadata,
      body: {
        schemaVersion: 1,
        doc: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              attrs: {
                nodeId: `74000000-0000-4000-8000-${String(index + 20).padStart(12, "0")}`,
              },
              content: [{ type: "text", text: fixture.bodyText }],
            },
          ],
        },
      },
    });
    if (!created.ok) {
      throw new Error(`Search fixture draft failed: ${created.error.code}`);
    }
    const published = await authoring.saveMaterial({
      actor: actorId,
      idempotencyKey: `74000000-0000-4000-8000-${String(index + 30).padStart(12, "0")}`,
      materialId: created.value.materialId,
      expectedContentVersion: created.value.contentVersion,
      publicationState: "published",
      metadata: fixture.metadata,
      body: {
        schemaVersion: 1,
        doc: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              attrs: {
                nodeId: `74000000-0000-4000-8000-${String(index + 20).padStart(12, "0")}`,
              },
              content: [{ type: "text", text: fixture.bodyText }],
            },
          ],
        },
      },
    });
    if (!published.ok) {
      throw new Error(`Search fixture publish failed: ${published.error.code}`);
    }
    const publishedAt = new Date(`2026-01-0${String(index + 1)}T00:00:00.000Z`);
    await testDatabase.prisma.$transaction([
      testDatabase.prisma.material.update({
        where: { id: created.value.materialId },
        data: { publishedAt },
      }),
      testDatabase.prisma.publishedMaterial.update({
        where: { materialId: created.value.materialId },
        data: { publishedAt, slug: fixture.slug },
      }),
    ]);
  }
}

async function seedSearchPerformanceCorpus(
  testDatabase: TestDatabase,
): Promise<void> {
  await testDatabase.prisma.$executeRaw(Prisma.sql`
    insert into materials.materials (
      id,
      slug,
      title,
      summary,
      topic_id,
      format_id,
      schema_version,
      body,
      created_by,
      access,
      publication_state,
      content_version,
      first_published_at,
      published_at,
      published_by
    )
    select
      overlay(
        overlay(
          md5('search-performance-material-' || sample::text)
          placing '4' from 13 for 1
        )
        placing '8' from 17 for 1
      )::uuid,
      'search-performance-' || sample::text,
      'Representative material ' || sample::text,
      case
        when sample = 10000 then 'Benchmark needle result ' || sample::text
        else repeat('Ordinary library result for representative search. ', 40) || sample::text
      end,
      '72000000-0000-4000-8000-000000000002'::uuid,
      '72000000-0000-4000-8000-000000000003'::uuid,
      1,
      '{"type":"doc","content":[]}'::jsonb,
      ${actorId}::uuid,
      'free',
      'published',
      1,
      timestamptz '2026-01-01 00:00:00+00' + sample * interval '1 second',
      timestamptz '2026-01-01 00:00:00+00' + sample * interval '1 second',
      ${actorId}::uuid
    from generate_series(1, 10000) as corpus(sample)
  `);
  await testDatabase.prisma.$executeRaw(Prisma.sql`
    insert into materials.published_materials (
      material_id,
      content_version,
      slug,
      title,
      summary,
      access,
      topic_id,
      format_id,
      published_by,
      published_at,
      public_search_text
    )
    select
      material.id,
      material.content_version,
      material.slug,
      material.title,
      material.summary,
      material.access,
      material.topic_id,
      material.format_id,
      material.published_by,
      material.published_at,
      'Platform Guide'
    from materials.materials as material
    where material.slug like 'search-performance-%'
  `);
  await testDatabase.prisma.$executeRaw(Prisma.sql`
    analyze materials.published_materials
  `);
}
