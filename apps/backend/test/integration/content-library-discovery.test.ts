import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { seedLocalDevelopment } from "../../src/development/seed-local-development.js";
import {
  discoverPublishedMaterials,
  listPublishedMaterials,
} from "../../src/modules/content-library/index.js";
import { anonymousSubject } from "../../src/modules/content-access/index.js";
import { assembleMaterials } from "../../src/modules/materials/index.js";
import { emptyCatalogVideos } from "../support/catalog-videos.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

describe("Content Library discovery", () => {
  let testDatabase: TestDatabase;

  beforeAll(async () => {
    testDatabase = await createMigratedTestDatabase();
    await seedLocalDevelopment(testDatabase.prisma);
    await testDatabase.prisma.topic.update({
      where: { slug: "platform" },
      data: { summary: "Platform boundaries, delivery and operations." },
    });
    await testDatabase.prisma.series.update({
      where: { slug: "platform-inside" },
      data: { summary: "Build the platform in a deliberate order." },
    });
  });

  afterAll(async () => {
    await testDatabase.dispose();
  });

  test("reads a Topic generated view from safe published projections", async () => {
    const { contentAccess, publishedMaterialReader } = assembleMaterials({
      prisma: testDatabase.prisma,
      authorPolicy: { canManage: () => false },
    });

    const result = await discoverPublishedMaterials(
      publishedMaterialReader,
      contentAccess,
      emptyCatalogVideos,
      {
        kind: "topic",
        slug: "platform",
        first: 24,
        subject: anonymousSubject,
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(`Topic discovery failed: ${result.error.code}`);
    }
    expect(result.value).toMatchObject({
      kind: "topic",
      reference: {
        name: "Platform",
        slug: "platform",
        summary: "Platform boundaries, delivery and operations.",
      },
      hasNext: false,
      relatedSeries: [
        expect.objectContaining({
          matchingMaterialCount: 2,
          name: "Создание Platform Inside",
          slug: "platform-inside",
          summary: "Build the platform in a deliberate order.",
          totalMaterialCount: 2,
        }),
      ],
    });
    expect(
      result.value.items.find(
        ({ slug }) => slug === "developer-pipeline-bez-poteri-konteksta",
      ),
    ).toMatchObject({ availability: "locked" });
    expect(
      result.value.items.find(
        ({ slug }) => slug === "kak-ustroen-inside-platform",
      ),
    ).toMatchObject({ availability: "available" });
    expect(JSON.stringify(result)).not.toContain(
      "Закрытое содержимое для участников",
    );
    expect(JSON.stringify(result)).not.toContain("schemaVersion");
  });

  test("derives every related Playlist beyond the current Topic material page", async () => {
    const topic = await testDatabase.prisma.topic.findUniqueOrThrow({
      where: { slug: "platform" },
      select: { id: true },
    });
    const published = await testDatabase.prisma.publishedMaterial.findMany({
      where: { topicId: topic.id },
      orderBy: [{ publishedAt: "desc" }, { materialId: "desc" }],
      select: { materialId: true },
    });
    const target = published.at(-1);
    if (target === undefined || published.length < 2) {
      throw new Error("Expected a second published Topic Material");
    }
    const beyondPageSeriesId = "75000000-0000-4000-8000-000000000010";
    await testDatabase.prisma.series.create({
      data: {
        id: beyondPageSeriesId,
        name: "Beyond first page",
        slug: "beyond-first-page",
        summary: "A derived Playlist outside the current material page.",
      },
    });
    await Promise.all([
      testDatabase.prisma.seriesMembership.create({
        data: {
          materialId: target.materialId,
          ordinal: 1,
          seriesId: beyondPageSeriesId,
        },
      }),
      testDatabase.prisma.publishedMaterialSeriesMembership.create({
        data: {
          materialId: target.materialId,
          ordinal: 1,
          seriesId: beyondPageSeriesId,
        },
      }),
    ]);

    const { contentAccess, publishedMaterialReader } = assembleMaterials({
      prisma: testDatabase.prisma,
      authorPolicy: { canManage: () => false },
    });
    const result = await discoverPublishedMaterials(
      publishedMaterialReader,
      contentAccess,
      emptyCatalogVideos,
      {
        kind: "topic",
        slug: "platform",
        first: 1,
        subject: anonymousSubject,
      },
    );
    if (!result.ok) throw new Error(result.error.code);
    expect(result.value.hasNext).toBe(true);
    expect(result.value.items.map(({ materialId }) => materialId)).not.toContain(
      target.materialId,
    );
    expect(result.value.relatedSeries).toContainEqual(
      expect.objectContaining({
        matchingMaterialCount: 1,
        slug: "beyond-first-page",
        totalMaterialCount: 1,
      }),
    );
  });

  test("keeps Series in author-defined ordinal order for free and closed teasers", async () => {
    const { contentAccess, publishedMaterialReader } = assembleMaterials({
      prisma: testDatabase.prisma,
      authorPolicy: { canManage: () => false },
    });

    const result = await discoverPublishedMaterials(
      publishedMaterialReader,
      contentAccess,
      emptyCatalogVideos,
      {
        kind: "series",
        slug: "platform-inside",
        first: null,
        subject: anonymousSubject,
      },
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        kind: "series",
        reference: {
          name: "Создание Platform Inside",
          slug: "platform-inside",
          summary: "Build the platform in a deliberate order.",
        },
        topics: [expect.objectContaining({ name: "Platform", slug: "platform" })],
        items: [
          expect.objectContaining({
            slug: "kak-ustroen-inside-platform",
            availability: "available",
            seriesMemberships: [
              expect.objectContaining({ ordinal: 1 }),
            ],
          }),
          expect.objectContaining({
            slug: "developer-pipeline-bez-poteri-konteksta",
            availability: "locked",
            seriesMemberships: [
              expect.objectContaining({ ordinal: 2 }),
            ],
          }),
        ],
      },
    });
  });

  test("places explicit pins before deterministic metadata matches", async () => {
    const { contentAccess, publishedMaterialReader } = assembleMaterials({
      prisma: testDatabase.prisma,
      authorPolicy: { canManage: () => false },
    });

    const result = await discoverPublishedMaterials(
      publishedMaterialReader,
      contentAccess,
      emptyCatalogVideos,
      {
        kind: "related",
        slug: "kak-ustroen-inside-platform",
        first: 4,
        subject: anonymousSubject,
      },
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        kind: "related",
      },
    });
    if (!result.ok) {
      throw new Error("Expected related Materials");
    }
    expect(result.value.items.slice(0, 2)).toMatchObject([
      { slug: "arkhitekturnaya-zametka-01" },
      {
        slug: "developer-pipeline-bez-poteri-konteksta",
        availability: "locked",
      },
    ]);
    expect(result.value.items.map(({ slug }) => slug)).not.toContain(
      "kak-ustroen-inside-platform",
    );
  });

  test("rejects self-pins and duplicate pin positions", async () => {
    const source = await testDatabase.prisma.material.findUniqueOrThrow({
      where: { slug: "kak-ustroen-inside-platform" },
      select: { id: true },
    });
    const secondTarget = await testDatabase.prisma.material.findUniqueOrThrow({
      where: { slug: "arkhitekturnaya-zametka-02" },
      select: { id: true },
    });

    await expect(
      testDatabase.prisma.materialRelatedPin.create({
        data: {
          sourceMaterialId: source.id,
          targetMaterialId: source.id,
          ordinal: 2,
        },
      }),
    ).rejects.toThrow();
    await expect(
      testDatabase.prisma.materialRelatedPin.create({
        data: {
          sourceMaterialId: source.id,
          targetMaterialId: secondTarget.id,
          ordinal: 1,
        },
      }),
    ).rejects.toThrow();
  });

  test("distinguishes missing taxonomy from an existing empty view", async () => {
    await testDatabase.prisma.topic.create({
      data: {
        id: "75000000-0000-4000-8000-000000000001",
        name: "Empty Topic",
        slug: "empty-topic",
      },
    });
    const { contentAccess, publishedMaterialReader } = assembleMaterials({
      prisma: testDatabase.prisma,
      authorPolicy: { canManage: () => false },
    });

    await expect(
      discoverPublishedMaterials(publishedMaterialReader, contentAccess, emptyCatalogVideos, {
        kind: "topic",
        slug: "empty-topic",
        first: 24,
        subject: anonymousSubject,
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: { kind: "topic", items: [], hasNext: false },
    });
    await expect(
      discoverPublishedMaterials(publishedMaterialReader, contentAccess, emptyCatalogVideos, {
        kind: "series",
        slug: "missing-series",
        first: 24,
        subject: anonymousSubject,
      }),
    ).resolves.toEqual({
      ok: false,
      error: { code: "discovery_not_found" },
    });
    await expect(
      discoverPublishedMaterials(publishedMaterialReader, contentAccess, emptyCatalogVideos, {
        kind: "topic",
        slug: "INVALID",
        first: 24,
        subject: anonymousSubject,
      }),
    ).resolves.toEqual({
      ok: false,
      error: { code: "invalid_request_shape" },
    });
  });

  test("hides archived collections from discovery while canonical readers remain valid", async () => {
    const { contentAccess, publishedMaterialReader } = assembleMaterials({
      prisma: testDatabase.prisma,
      authorPolicy: { canManage: () => false },
    });
    await Promise.all([
      testDatabase.prisma.topic.update({
        where: { slug: "platform" },
        data: { archivedAt: new Date() },
      }),
      testDatabase.prisma.series.update({
        where: { slug: "platform-inside" },
        data: { archivedAt: new Date() },
      }),
    ]);
    try {
      const catalog = await publishedMaterialReader.listProjections({ first: 24 });
      if (!catalog.ok) throw new Error(catalog.error.code);
      expect(catalog.value.facets.topics.map(({ slug }) => slug)).not.toContain(
        "platform",
      );
      expect(catalog.value.facets.series.map(({ slug }) => slug)).not.toContain(
        "platform-inside",
      );

      const topic = await discoverPublishedMaterials(
        publishedMaterialReader,
        contentAccess,
        emptyCatalogVideos,
        {
          kind: "topic",
          slug: "platform",
          first: 24,
          subject: anonymousSubject,
        },
      );
      const series = await discoverPublishedMaterials(
        publishedMaterialReader,
        contentAccess,
        emptyCatalogVideos,
        {
          kind: "series",
          slug: "platform-inside",
          first: 24,
          subject: anonymousSubject,
        },
      );
      expect(topic).toMatchObject({
        ok: true,
        value: { reference: { slug: "platform" } },
      });
      if (!topic.ok) throw new Error(topic.error.code);
      expect(topic.value.relatedSeries.map(({ slug }) => slug)).not.toContain(
        "platform-inside",
      );
      expect(series).toMatchObject({
        ok: true,
        value: { reference: { slug: "platform-inside" }, topics: [] },
      });

      const discoveryFilter = await listPublishedMaterials(
        publishedMaterialReader,
        contentAccess,
        emptyCatalogVideos,
        {
          first: 24,
          subject: anonymousSubject,
          topicSlugs: ["platform"],
        },
      );
      expect(discoveryFilter).toMatchObject({
        ok: true,
        value: { items: [], totalCount: 0 },
      });

      const canonicalTopic = await listPublishedMaterials(
        publishedMaterialReader,
        contentAccess,
        emptyCatalogVideos,
        {
          canonicalTopicSlug: "platform",
          first: 24,
          subject: anonymousSubject,
        },
      );
      expect(canonicalTopic.ok).toBe(true);
      if (!canonicalTopic.ok) throw new Error(canonicalTopic.error.code);
      expect(canonicalTopic.value.items.length).toBeGreaterThan(0);
      expect(
        canonicalTopic.value.items.every(({ topic }) => topic.slug === "platform"),
      ).toBe(true);
    } finally {
      await Promise.all([
        testDatabase.prisma.topic.update({
          where: { slug: "platform" },
          data: { archivedAt: null },
        }),
        testDatabase.prisma.series.update({
          where: { slug: "platform-inside" },
          data: { archivedAt: null },
        }),
      ]);
    }
  });
});
