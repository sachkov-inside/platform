import {
  fixedTestInstant,
  registerFixedClock,
} from "../support/fixed-clock.js";

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import { seedLocalDevelopment } from "../../src/development/seed-local-development.js";
import {
  discoverPublishedMaterials,
  listPublishedMaterials,
} from "../../src/modules/content-library/index.js";
import { anonymousSubject } from "../../src/modules/content-access/index.js";
import { assembleMaterials } from "../../src/entrypoints/composition/assemble-materials.js";
import { emptyCatalogVideos } from "../support/catalog-videos.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

registerFixedClock();

describe("Content Library discovery", () => {
  let testDatabase: TestDatabase;

  beforeAll(async () => {
    testDatabase = await createMigratedTestDatabase();
    const instant = fixedTestInstant();
    // Background projections precede the representative pair in this paginated fixture.
    vi.setSystemTime(instant - 1);
    try {
      await seedLocalDevelopment(testDatabase.prisma);
    } finally {
      vi.setSystemTime(instant);
    }
    await testDatabase.prisma.publishedMaterial.updateMany({
      where: {
        slug: {
          in: [
            "kak-ustroen-inside-platform",
            "developer-pipeline-bez-poteri-konteksta",
          ],
        },
      },
      data: { publishedAt: new Date(instant) },
    });
    await testDatabase.prisma.topic.update({
      where: { slug: "platform" },
      data: { summary: "Platform boundaries, delivery and operations." },
    });
    await testDatabase.prisma.product.update({
      where: { slug: "platform-inside" },
      data: {
        audience: "Engineers who own a product surface end to end.",
        outcome: "Ship a working slice of the platform in a deliberate order.",
        prerequisites: "Comfort with Git and a running local stack.",
        scope: "One product surface; operations stay outside this Product.",
        summary: "Build the platform in a deliberate order.",
      },
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
        introduction: null,
        name: "Platform",
        slug: "platform",
        summary: "Platform boundaries, delivery and operations.",
      },
      hasNext: true,
    });
    expect(
      result.value.relatedProduct.find(
        ({ slug }) => slug === "platform-inside",
      ),
    ).toMatchObject({
      matchingMaterialCount: 2,
      name: "Создание Platform Inside",
      slug: "platform-inside",
      summary: "Build the platform in a deliberate order.",
      totalMaterialCount: 2,
    });
    expect(
      result.value.items.find(
        ({ slug }) => slug === "developer-pipeline-bez-poteri-konteksta",
      ),
    ).toMatchObject({ availability: "locked" });
    // A free lesson of a Product opens only after Telegram sign-in (#1825): the guest sees a teaser.
    expect(
      result.value.items.find(
        ({ slug }) => slug === "kak-ustroen-inside-platform",
      ),
    ).toMatchObject({ access: "free", availability: "locked" });
    expect(JSON.stringify(result)).not.toContain(
      "Закрытое содержимое для участников",
    );
    expect(JSON.stringify(result)).not.toContain("schemaVersion");
  });

  test("derives every related Product beyond the current Topic material page", async () => {
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
    const beyondPageProductId = "75000000-0000-4000-8000-000000000010";
    await testDatabase.prisma.product.create({
      data: {
        id: beyondPageProductId,
        name: "Beyond first page",
        slug: "beyond-first-page",
        summary: "A derived Playlist outside the current material page.",
      },
    });
    await Promise.all([
      testDatabase.prisma.productMembership.create({
        data: {
          materialId: target.materialId,
          productId: beyondPageProductId,
        },
      }),
      testDatabase.prisma.publishedMaterialProductMembership.create({
        data: {
          materialId: target.materialId,
          productId: beyondPageProductId,
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
    expect(
      result.value.items.map(({ materialId }) => materialId),
    ).not.toContain(target.materialId);
    expect(result.value.relatedProduct).toContainEqual(
      expect.objectContaining({
        matchingMaterialCount: 1,
        slug: "beyond-first-page",
        totalMaterialCount: 1,
      }),
    );
  });

  test("keeps Product in author-defined ordinal order for free and closed teasers", async () => {
    const { contentAccess, publishedMaterialReader } = assembleMaterials({
      prisma: testDatabase.prisma,
      authorPolicy: { canManage: () => false },
    });

    const result = await discoverPublishedMaterials(
      publishedMaterialReader,
      contentAccess,
      emptyCatalogVideos,
      {
        kind: "product",
        slug: "platform-inside",
        first: null,
        subject: anonymousSubject,
      },
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        kind: "product",
        reference: {
          introduction: {
            audience: "Engineers who own a product surface end to end.",
            outcome:
              "Ship a working slice of the platform in a deliberate order.",
            prerequisites: "Comfort with Git and a running local stack.",
            scope: "One product surface; operations stay outside this Product.",
          },
          name: "Создание Platform Inside",
          slug: "platform-inside",
          summary: "Build the platform in a deliberate order.",
        },
        topics: [
          expect.objectContaining({ name: "Platform", slug: "platform" }),
        ],
        items: [
          expect.objectContaining({
            slug: "kak-ustroen-inside-platform",
            access: "free",
            // The guest signs in through Telegram before a free lesson opens (#1825).
            availability: "locked",
            productMemberships: [expect.objectContaining({ ordinal: 1 })],
          }),
          expect.objectContaining({
            slug: "developer-pipeline-bez-poteri-konteksta",
            availability: "locked",
            productMemberships: [expect.objectContaining({ ordinal: 2 })],
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
      discoverPublishedMaterials(
        publishedMaterialReader,
        contentAccess,
        emptyCatalogVideos,
        {
          kind: "topic",
          slug: "empty-topic",
          first: 24,
          subject: anonymousSubject,
        },
      ),
    ).resolves.toMatchObject({
      ok: true,
      value: { kind: "topic", items: [], hasNext: false },
    });
    await expect(
      discoverPublishedMaterials(
        publishedMaterialReader,
        contentAccess,
        emptyCatalogVideos,
        {
          kind: "product",
          slug: "missing-product",
          first: 24,
          subject: anonymousSubject,
        },
      ),
    ).resolves.toEqual({
      ok: false,
      error: { code: "discovery_not_found" },
    });
    await expect(
      discoverPublishedMaterials(
        publishedMaterialReader,
        contentAccess,
        emptyCatalogVideos,
        {
          kind: "topic",
          slug: "INVALID",
          first: 24,
          subject: anonymousSubject,
        },
      ),
    ).resolves.toEqual({
      ok: false,
      error: { code: "invalid_request_shape" },
    });
  });

  test("hides archived Products from guest discovery while canonical Topics remain readable", async () => {
    const { contentAccess, publishedMaterialReader } = assembleMaterials({
      prisma: testDatabase.prisma,
      authorPolicy: { canManage: () => false },
    });
    await Promise.all([
      testDatabase.prisma.topic.update({
        where: { slug: "platform" },
        // deterministic-test-allow wall-clock: Date is fixed per case by registerFixedClock; production consumers share this virtual Date.
        data: { archivedAt: new Date() },
      }),
      testDatabase.prisma.product.update({
        where: { slug: "platform-inside" },
        // deterministic-test-allow wall-clock: Date is fixed per case by registerFixedClock; production consumers share this virtual Date.
        data: { archivedAt: new Date() },
      }),
    ]);
    try {
      const catalog = await publishedMaterialReader.listProjections({
        first: 24,
      });
      if (!catalog.ok) throw new Error(catalog.error.code);
      expect(catalog.value.facets.topics.map(({ slug }) => slug)).not.toContain(
        "platform",
      );
      expect(
        catalog.value.facets.products.map(({ slug }) => slug),
      ).not.toContain("platform-inside");

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
      const product = await discoverPublishedMaterials(
        publishedMaterialReader,
        contentAccess,
        emptyCatalogVideos,
        {
          kind: "product",
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
      expect(topic.value.relatedProduct.map(({ slug }) => slug)).not.toContain(
        "platform-inside",
      );
      expect(product).toMatchObject({
        ok: false,
        error: { code: "discovery_not_found" },
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
        canonicalTopic.value.items.every(
          ({ topic }) => topic.slug === "platform",
        ),
      ).toBe(true);
      expect(
        canonicalTopic.value.facets.formats.reduce(
          (count, format) => count + format.count,
          0,
        ),
      ).toBe(canonicalTopic.value.totalCount);
    } finally {
      await Promise.all([
        testDatabase.prisma.topic.update({
          where: { slug: "platform" },
          data: { archivedAt: null },
        }),
        testDatabase.prisma.product.update({
          where: { slug: "platform-inside" },
          data: { archivedAt: null },
        }),
      ]);
    }
  });
});
