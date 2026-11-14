import { authorProductProgramme } from "../fixtures/author-product-programme.js";
import { registerFixedClock } from "../support/fixed-clock.js";

import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { assembleMaterials } from "../../src/entrypoints/composition/assemble-materials.js";
import { representativeDocument } from "../fixtures/material-body/representative.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

registerFixedClock();

const actor = "89000000-0000-4000-8000-000000000301";
const topicId = "89000000-0000-4000-8000-000000000302";
const formatId = "guide";

describe("Product roadmap", () => {
  let testDatabase: TestDatabase;
  let materials: ReturnType<typeof assembleMaterials>;
  let sequence = 0;

  const product = async (slug: string): Promise<string> => {
    const created = await materials.authoring.createContentCollection({
      actor,
      kind: "product",
      name: slug,
      slug,
      summary: "",
    });
    if (!created.ok) throw new Error(created.error.code);
    return created.value.id;
  };

  const material = async (
    title: string,
    productIds: readonly string[],
  ): Promise<string> => {
    sequence += 1;
    const metadata = {
      access: "free" as const,
      formatId,
      difficulty: null,
      outcomes: [],
      productIds: [...productIds],
      summary: `${title} summary.`,
      tagIds: [],
      title,
      topicId,
    };
    const created = await materials.authoring.createDraft({
      actor,
      idempotencyKey: `product-roadmap-create-${String(sequence)}`,
      metadata,
      body: representativeDocument(`${title} body.`),
    });
    if (!created.ok) throw new Error(created.error.code);
    const published = await materials.authoring.saveMaterial({
      actor,
      idempotencyKey: `product-roadmap-publish-${String(sequence)}`,
      materialId: created.value.materialId,
      expectedContentVersion: 1,
      publicationState: "published",
      metadata,
      body: representativeDocument(`${title} body.`),
    });
    if (!published.ok) throw new Error(published.error.code);
    return created.value.materialId;
  };

  /** A Product with a written chapter, a chapter in progress and an empty planned chapter. */
  const programme = async (slug: string) => {
    const productId = await product(slug);
    const lesson = await material(`${slug} урок`, [productId]);
    const [written, writing, planned] = [
      randomUUID(),
      randomUUID(),
      randomUUID(),
    ];
    const loaded = await materials.authoring.loadProductOrder({
      actor,
      productId,
    });
    if (!loaded.ok) throw new Error(loaded.error.code);
    const saved = await authorProductProgramme(materials.authoring, {
      actor,
      productId,
      expectedOrderVersion: loaded.value.orderVersion,
      orderedMaterialIds: [lesson],
      chapters: [
        { id: written, name: "Готово", summary: "" },
        { id: writing, name: "Пишется", summary: "" },
        { id: planned, name: "В планах", summary: "Итог.\n\n- тема" },
      ],
      chapterAssignments: { [lesson]: written },
    });
    if (!saved.ok) throw new Error(saved.error.code);
    return { productId, lesson, written, writing, planned };
  };

  beforeAll(async () => {
    testDatabase = await createMigratedTestDatabase();
    materials = assembleMaterials({
      prisma: testDatabase.prisma,
      authorPolicy: { canManage: () => true },
    });
    await testDatabase.prisma.topic.create({
      data: { id: topicId, slug: "product-roadmap", name: "Product roadmap" },
    });
  });

  afterAll(async () => {
    await testDatabase.dispose();
  });

  test("replaces the roadmap completely, reads it back and deletes it with null", async () => {
    const { productId, written, writing, planned } =
      await programme("roadmap-lifecycle");

    await expect(
      materials.authoring.loadProductRoadmap({ actor, productId }),
    ).resolves.toEqual({ ok: true, value: { productId, roadmap: null } });

    const roadmap = {
      updatedOn: "2026-11-13",
      chapters: [
        { chapterId: written, status: "done" as const },
        {
          chapterId: writing.toUpperCase(),
          status: "writing" as const,
          upcomingLessons: [
            { title: "  Схема данных  ", state: "writing" as const },
            { title: "Миграции", state: "soon" as const },
          ],
        },
        { chapterId: planned, status: "planned" as const },
      ],
    };
    const expected = {
      productId,
      roadmap: {
        updatedOn: "2026-11-13",
        chapters: [
          { chapterId: written, status: "done", upcomingLessons: [] },
          {
            chapterId: writing,
            status: "writing",
            upcomingLessons: [
              { title: "Схема данных", state: "writing" },
              { title: "Миграции", state: "soon" },
            ],
          },
          { chapterId: planned, status: "planned", upcomingLessons: [] },
        ],
      },
    };
    await expect(
      materials.authoring.updateProductRoadmap({ actor, productId, roadmap }),
    ).resolves.toEqual({ ok: true, value: expected });
    await expect(
      materials.authoring.loadProductRoadmap({ actor, productId }),
    ).resolves.toEqual({ ok: true, value: expected });
    await expect(
      materials.authoring.updateProductRoadmap({ actor, productId, roadmap }),
    ).resolves.toEqual({ ok: true, value: expected });

    const replaced = {
      updatedOn: "2026-11-14",
      chapters: [{ chapterId: writing, status: "done" as const }],
    };
    await expect(
      materials.authoring.updateProductRoadmap({
        actor,
        productId,
        roadmap: replaced,
      }),
    ).resolves.toEqual({
      ok: true,
      value: {
        productId,
        roadmap: {
          updatedOn: "2026-11-14",
          chapters: [
            { chapterId: writing, status: "done", upcomingLessons: [] },
          ],
        },
      },
    });

    await expect(
      materials.authoring.updateProductRoadmap({
        actor,
        productId,
        roadmap: null,
      }),
    ).resolves.toEqual({ ok: true, value: { productId, roadmap: null } });
    await expect(
      materials.authoring.loadProductRoadmap({ actor, productId }),
    ).resolves.toEqual({ ok: true, value: { productId, roadmap: null } });
    expect(
      await testDatabase.prisma.productRoadmap.count({ where: { productId } }),
    ).toBe(0);
  });

  test("refuses a foreign or repeated chapter and upcoming lessons outside a writing chapter", async () => {
    const { productId, written, writing } = await programme("roadmap-invalid");
    const other = await programme("roadmap-invalid-other");

    await expect(
      materials.authoring.updateProductRoadmap({
        actor,
        productId,
        roadmap: {
          updatedOn: "2026-11-13",
          chapters: [
            { chapterId: written, status: "done" },
            { chapterId: other.written, status: "done" },
          ],
        },
      }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: "invalid_reference",
        issues: [
          {
            code: "product_roadmap_chapter_not_in_product",
            path: "/roadmap/chapters/1/chapterId",
          },
        ],
      },
    });
    await expect(
      materials.authoring.updateProductRoadmap({
        actor,
        productId,
        roadmap: {
          updatedOn: "2026-11-13",
          chapters: [
            { chapterId: writing, status: "writing" },
            { chapterId: writing, status: "done" },
          ],
        },
      }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: "invalid_reference",
        issues: [
          {
            code: "product_roadmap_chapter_duplicate",
            path: "/roadmap/chapters/1/chapterId",
          },
        ],
      },
    });
    await expect(
      materials.authoring.updateProductRoadmap({
        actor,
        productId,
        roadmap: {
          updatedOn: "2026-11-13",
          chapters: [
            {
              chapterId: written,
              status: "done",
              upcomingLessons: [{ title: "Лишний", state: "soon" }],
            },
          ],
        },
      }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: "invalid_content",
        issues: [
          {
            code: "product_roadmap_upcoming_lessons_not_writing",
            path: "/roadmap/chapters/0/upcomingLessons",
          },
        ],
      },
    });

    for (const roadmap of [
      { updatedOn: "13.11.2026", chapters: [] },
      { updatedOn: "2026-02-30", chapters: [] },
      {
        updatedOn: "2026-11-13",
        chapters: [{ chapterId: writing, status: "later" }],
      },
      {
        updatedOn: "2026-11-13",
        chapters: [
          {
            chapterId: writing,
            status: "writing",
            upcomingLessons: [{ title: " ", state: "soon" }],
          },
        ],
      },
      {
        updatedOn: "2026-11-13",
        chapters: [
          {
            chapterId: writing,
            status: "writing",
            upcomingLessons: [{ title: "x".repeat(161), state: "soon" }],
          },
        ],
      },
      {
        updatedOn: "2026-11-13",
        chapters: [
          {
            chapterId: writing,
            status: "writing",
            upcomingLessons: Array.from({ length: 51 }, (_, index) => ({
              title: `Урок ${String(index)}`,
              state: "soon",
            })),
          },
        ],
      },
    ]) {
      // A malformed body reaches the operation as untyped input, as it does from the transport.
      const refused: unknown = await Reflect.apply(
        materials.authoring.updateProductRoadmap,
        undefined,
        [{ actor, productId, roadmap }],
      );
      expect(refused).toMatchObject({
        ok: false,
        error: { code: "invalid_content" },
      });
    }

    await expect(
      materials.authoring.updateProductRoadmap({
        actor,
        productId: randomUUID(),
        roadmap: null,
      }),
    ).resolves.toEqual({ ok: false, error: { code: "product_not_found" } });
    await expect(
      materials.authoring.loadProductRoadmap({
        actor,
        productId: randomUUID(),
      }),
    ).resolves.toEqual({ ok: false, error: { code: "product_not_found" } });
    await expect(
      materials.authoring.loadProductRoadmap({ actor, productId }),
    ).resolves.toEqual({ ok: true, value: { productId, roadmap: null } });
  });

  test("an account that cannot manage Products neither reads nor writes the roadmap", async () => {
    const { productId, written } = await programme("roadmap-forbidden");
    const reader = assembleMaterials({
      prisma: testDatabase.prisma,
      authorPolicy: { canManage: () => false },
    });
    await expect(
      reader.authoring.updateProductRoadmap({
        actor,
        productId,
        roadmap: {
          updatedOn: "2026-11-13",
          chapters: [{ chapterId: written, status: "done" }],
        },
      }),
    ).resolves.toEqual({ ok: false, error: { code: "forbidden" } });
    await expect(
      reader.authoring.loadProductRoadmap({ actor, productId }),
    ).resolves.toEqual({ ok: false, error: { code: "forbidden" } });
    expect(
      await testDatabase.prisma.productRoadmap.count({ where: { productId } }),
    ).toBe(0);
  });

  test("an imported archived Product accepts a roadmap while its composition stays source-owned", async () => {
    const { productId, written } = await programme("roadmap-imported");
    await testDatabase.prisma.product.update({
      where: { id: productId },
      data: {
        sourceId: "fixture:roadmap-imported",
        archivedAt: new Date("2026-11-12T09:00:00.000Z"),
      },
    });
    const order = await materials.authoring.loadProductOrder({
      actor,
      productId,
    });
    if (!order.ok) throw new Error(order.error.code);
    await expect(
      materials.authoring.reorderProduct({
        actor,
        productId,
        expectedOrderVersion: order.value.orderVersion,
        orderedMaterialIds: [],
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: "forbidden" } });

    await expect(
      materials.authoring.updateProductRoadmap({
        actor,
        productId,
        roadmap: {
          updatedOn: "2026-11-13",
          chapters: [{ chapterId: written, status: "done" }],
        },
      }),
    ).resolves.toMatchObject({ ok: true });
    const after = await materials.authoring.loadProductOrder({
      actor,
      productId,
    });
    if (!after.ok) throw new Error(after.error.code);
    expect(after.value.orderVersion).toBe(order.value.orderVersion);
  });

  test("the public Product page carries the roadmap of existing chapters", async () => {
    const slug = "roadmap-public";
    const { productId, written, writing, planned } = await programme(slug);

    const before = await materials.publishedMaterialReader.discoverProjections({
      kind: "product",
      slug,
      first: null,
    });
    if (!before.ok) throw new Error(before.error.code);
    expect(before.value.roadmapUpdatedOn).toBeNull();
    expect(
      before.value.chapters.map(({ id, roadmapStatus, upcomingLessons }) => ({
        id,
        roadmapStatus,
        upcomingLessons,
      })),
    ).toEqual([
      { id: written, roadmapStatus: null, upcomingLessons: [] },
      { id: writing, roadmapStatus: null, upcomingLessons: [] },
      { id: planned, roadmapStatus: null, upcomingLessons: [] },
    ]);

    const saved = await materials.authoring.updateProductRoadmap({
      actor,
      productId,
      roadmap: {
        updatedOn: "2026-11-13",
        chapters: [
          {
            chapterId: writing,
            status: "writing",
            upcomingLessons: [{ title: "Схема данных", state: "writing" }],
          },
          { chapterId: written, status: "done" },
        ],
      },
    });
    if (!saved.ok) throw new Error(saved.error.code);

    // A chapter removed after the roadmap was written leaves its entry ignored.
    const order = await materials.authoring.loadProductOrder({
      actor,
      productId,
    });
    if (!order.ok) throw new Error(order.error.code);
    const pruned = await materials.authoring.reorderProduct({
      actor,
      productId,
      expectedOrderVersion: order.value.orderVersion,
      orderedMaterialIds: order.value.items.map(({ materialId }) => materialId),
      chapters: order.value.chapters
        .filter(({ id }) => id !== written)
        .map(({ id, name, summary }) => ({ id, name, summary })),
      programmePlacements: order.value.programmePlacements.map((placement) => ({
        ...placement,
        chapterId: writing,
      })),
    });
    if (!pruned.ok) throw new Error(pruned.error.code);

    const page = await materials.publishedMaterialReader.discoverProjections({
      kind: "product",
      slug,
      first: null,
    });
    if (!page.ok) throw new Error(page.error.code);
    expect(page.value.roadmapUpdatedOn).toBe("2026-11-13");
    expect(
      page.value.chapters.map(({ id, roadmapStatus, upcomingLessons }) => ({
        id,
        roadmapStatus,
        upcomingLessons,
      })),
    ).toEqual([
      {
        id: writing,
        roadmapStatus: "writing",
        upcomingLessons: [{ title: "Схема данных", state: "writing" }],
      },
      { id: planned, roadmapStatus: null, upcomingLessons: [] },
    ]);

    const topicPage =
      await materials.publishedMaterialReader.discoverProjections({
        kind: "topic",
        slug: "product-roadmap",
        first: 10,
      });
    if (!topicPage.ok) throw new Error(topicPage.error.code);
    expect(topicPage.value.roadmapUpdatedOn).toBeUndefined();
  });
});
