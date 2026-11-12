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

const actor = "89000000-0000-4000-8000-000000000201";
const topicId = "89000000-0000-4000-8000-000000000202";
const formatId = "guide";

const byId = (ids: readonly string[]) =>
  [...ids].sort((left, right) => left.localeCompare(right));

describe("Product topics", () => {
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
    publish = true,
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
      idempotencyKey: `product-topic-create-${String(sequence)}`,
      metadata,
      body: representativeDocument(`${title} body.`),
    });
    if (!created.ok) throw new Error(created.error.code);
    if (publish) {
      const published = await materials.authoring.saveMaterial({
        actor,
        idempotencyKey: `product-topic-publish-${String(sequence)}`,
        materialId: created.value.materialId,
        expectedContentVersion: 1,
        publicationState: "published",
        metadata,
        body: representativeDocument(`${title} body.`),
      });
      if (!published.ok) throw new Error(published.error.code);
    }
    return created.value.materialId;
  };

  const load = async (productId: string) => {
    const loaded = await materials.authoring.loadProductOrder({
      actor,
      productId,
    });
    if (!loaded.ok) throw new Error(loaded.error.code);
    return loaded.value;
  };

  beforeAll(async () => {
    testDatabase = await createMigratedTestDatabase();
    materials = assembleMaterials({
      prisma: testDatabase.prisma,
      authorPolicy: { canManage: () => true },
    });
    await testDatabase.prisma.topic.create({
      data: { id: topicId, slug: "product-topics", name: "Product topics" },
    });
  });

  afterAll(async () => {
    await testDatabase.dispose();
  });

  test("creates, renames, reorders and deletes topics and keeps their identities", async () => {
    const productId = await product("topics-lifecycle");
    const first = await material("Первый", [productId]);
    const second = await material("Второй", [productId]);
    const third = await material("Третий", [productId]);
    const [basics, practice] = [randomUUID(), randomUUID()];

    const initial = await load(productId);
    expect(initial.topics).toEqual([]);

    const created = await materials.authoring.updateProductTopics({
      actor,
      productId,
      expectedOrderVersion: initial.orderVersion,
      topics: [
        {
          id: basics,
          name: "  Основы  ",
          summary: " Что нужно знать. ",
          materialIds: [second, first],
        },
        { id: practice, name: "Практика", summary: "", materialIds: [third] },
      ],
    });
    if (!created.ok) throw new Error(created.error.code);
    const afterCreate = await load(productId);
    expect(created.value.orderVersion).toBe(afterCreate.orderVersion);
    expect(afterCreate.orderVersion).not.toBe(initial.orderVersion);
    const catalogue = afterCreate.items.map(({ materialId }) => materialId);
    expect(afterCreate.topics).toEqual([
      {
        id: basics,
        name: "Основы",
        summary: "Что нужно знать.",
        materialIds: catalogue.filter((id) => id === first || id === second),
      },
      { id: practice, name: "Практика", summary: "", materialIds: [third] },
    ]);

    const repeated = await materials.authoring.updateProductTopics({
      actor,
      productId,
      expectedOrderVersion: initial.orderVersion,
      topics: [
        {
          id: basics,
          name: "Основы",
          summary: "Что нужно знать.",
          materialIds: [first, second],
        },
        { id: practice, name: "Практика", summary: "", materialIds: [third] },
      ],
    });
    expect(repeated).toEqual({
      ok: true,
      value: { productId, orderVersion: afterCreate.orderVersion },
    });

    const reordered = await materials.authoring.updateProductTopics({
      actor,
      productId,
      expectedOrderVersion: afterCreate.orderVersion,
      topics: [
        {
          id: practice,
          name: "Практика и проекты",
          summary: "",
          materialIds: [third, first],
        },
        { id: basics, name: "Основы", summary: "", materialIds: [] },
      ],
    });
    if (!reordered.ok) throw new Error(reordered.error.code);
    const afterReorder = await load(productId);
    expect(afterReorder.topics).toEqual([
      {
        id: practice,
        name: "Практика и проекты",
        summary: "",
        materialIds: catalogue.filter((id) => id === first || id === third),
      },
      { id: basics, name: "Основы", summary: "", materialIds: [] },
    ]);

    const deleted = await materials.authoring.updateProductTopics({
      actor,
      productId,
      expectedOrderVersion: afterReorder.orderVersion,
      topics: [],
    });
    if (!deleted.ok) throw new Error(deleted.error.code);
    const afterDelete = await load(productId);
    expect(afterDelete.topics).toEqual([]);
    expect(afterDelete.orderVersion).toBe(initial.orderVersion);
    expect(afterDelete.items.map(({ materialId }) => materialId)).toEqual(
      catalogue,
    );
    expect(
      await testDatabase.prisma.productTopicMaterial.count({
        where: { productId },
      }),
    ).toBe(0);
  });

  test("rejects foreign, repeated and malformed assignments and a stale version", async () => {
    const productId = await product("topics-invalid");
    const other = await product("topics-invalid-other");
    const member = await material("Участник", [productId]);
    const foreign = await material("Чужой", [other]);
    const initial = await load(productId);
    const topic = randomUUID();

    await expect(
      materials.authoring.updateProductTopics({
        actor,
        productId,
        expectedOrderVersion: initial.orderVersion,
        topics: [
          { id: topic, name: "Тема", summary: "", materialIds: [foreign] },
        ],
      }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: "invalid_reference",
        issues: [
          {
            code: "product_topic_material_not_in_product",
            path: "/topics/0/materialIds/0",
          },
        ],
      },
    });
    await expect(
      materials.authoring.updateProductTopics({
        actor,
        productId,
        expectedOrderVersion: initial.orderVersion,
        topics: [
          { id: topic, name: "Тема", summary: "", materialIds: [member] },
          {
            id: randomUUID(),
            name: "Другая",
            summary: "",
            materialIds: [member],
          },
        ],
      }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: "invalid_reference",
        issues: [
          {
            code: "product_topic_material_claimed",
            path: "/topics/1/materialIds/0",
          },
        ],
      },
    });

    const otherTopic = randomUUID();
    const otherInitial = await load(other);
    const claimedSetup = await materials.authoring.updateProductTopics({
      actor,
      productId: other,
      expectedOrderVersion: otherInitial.orderVersion,
      topics: [{ id: otherTopic, name: "Чужая", summary: "", materialIds: [] }],
    });
    expect(claimedSetup.ok).toBe(true);
    await expect(
      materials.authoring.updateProductTopics({
        actor,
        productId,
        expectedOrderVersion: initial.orderVersion,
        topics: [
          { id: otherTopic, name: "Тема", summary: "", materialIds: [] },
        ],
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: "invalid_reference",
        issues: [{ code: "product_topic_claimed", path: "/topics/0/id" }],
      },
    });

    const duplicateId = randomUUID();
    for (const topics of [
      [{ id: topic, name: " ", summary: "", materialIds: [] }],
      [{ id: topic, name: "Тема", summary: "x".repeat(301), materialIds: [] }],
      [{ id: topic, name: "x".repeat(121), summary: "", materialIds: [] }],
      [
        { id: duplicateId, name: "Тема", summary: "", materialIds: [] },
        { id: duplicateId, name: "Снова", summary: "", materialIds: [] },
      ],
      Array.from({ length: 51 }, (_, index) => ({
        id: randomUUID(),
        name: `Тема ${String(index)}`,
        summary: "",
        materialIds: [],
      })),
    ])
      await expect(
        materials.authoring.updateProductTopics({
          actor,
          productId,
          expectedOrderVersion: initial.orderVersion,
          topics,
        }),
      ).resolves.toMatchObject({
        ok: false,
        error: { code: "invalid_content" },
      });

    const saved = await materials.authoring.updateProductTopics({
      actor,
      productId,
      expectedOrderVersion: initial.orderVersion,
      topics: [{ id: topic, name: "Тема", summary: "", materialIds: [member] }],
    });
    if (!saved.ok) throw new Error(saved.error.code);
    await expect(
      materials.authoring.updateProductTopics({
        actor,
        productId,
        expectedOrderVersion: initial.orderVersion,
        topics: [],
      }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: "stale_product_order",
        currentOrderVersion: saved.value.orderVersion,
      },
    });
    await expect(
      materials.authoring.updateProductTopics({
        actor,
        productId: randomUUID(),
        expectedOrderVersion: initial.orderVersion,
        topics: [],
      }),
    ).resolves.toEqual({ ok: false, error: { code: "product_not_found" } });
    expect((await load(productId)).topics).toEqual([
      { id: topic, name: "Тема", summary: "", materialIds: [member] },
    ]);
  });

  test("a topic edit makes a concurrent composition save stale", async () => {
    const productId = await product("topics-stale-composition");
    const member = await material("Урок", [productId]);
    const initial = await load(productId);
    const saved = await materials.authoring.updateProductTopics({
      actor,
      productId,
      expectedOrderVersion: initial.orderVersion,
      topics: [
        { id: randomUUID(), name: "Тема", summary: "", materialIds: [member] },
      ],
    });
    if (!saved.ok) throw new Error(saved.error.code);
    await expect(
      materials.authoring.reorderProduct({
        actor,
        productId,
        expectedOrderVersion: initial.orderVersion,
        orderedMaterialIds: [],
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "stale_product_order" },
    });
  });

  test("an imported archived Product accepts topics while its composition stays source-owned", async () => {
    const productId = await product("topics-imported");
    const member = await material("Импортированный урок", [productId]);
    await testDatabase.prisma.product.update({
      where: { id: productId },
      data: {
        sourceId: "fixture:topics-imported",
        archivedAt: new Date("2026-11-12T09:00:00.000Z"),
      },
    });
    const initial = await load(productId);
    await expect(
      materials.authoring.reorderProduct({
        actor,
        productId,
        expectedOrderVersion: initial.orderVersion,
        orderedMaterialIds: [],
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: "forbidden" } });
    const topic = randomUUID();
    const saved = await materials.authoring.updateProductTopics({
      actor,
      productId,
      expectedOrderVersion: initial.orderVersion,
      topics: [{ id: topic, name: "Тема", summary: "", materialIds: [member] }],
    });
    expect(saved.ok).toBe(true);
    const loaded = await load(productId);
    expect(loaded.topics).toEqual([
      { id: topic, name: "Тема", summary: "", materialIds: [member] },
    ]);
    expect(loaded.items.map(({ materialId }) => materialId)).toEqual([member]);
  });

  test("assignments survive a composition save and leave with their Material", async () => {
    const productId = await product("topics-composition");
    const first = await material("Первый", [productId]);
    const second = await material("Второй", [productId]);
    const third = await material("Третий", [productId]);
    const topic = randomUUID();
    const empty = randomUUID();
    const initial = await load(productId);
    const saved = await materials.authoring.updateProductTopics({
      actor,
      productId,
      expectedOrderVersion: initial.orderVersion,
      topics: [
        {
          id: topic,
          name: "Тема",
          summary: "",
          materialIds: [first, second, third],
        },
        { id: empty, name: "Пустая", summary: "", materialIds: [] },
      ],
    });
    if (!saved.ok) throw new Error(saved.error.code);

    const before = await load(productId);
    const programmed = await authorProductProgramme(materials.authoring, {
      actor,
      productId,
      expectedOrderVersion: before.orderVersion,
      orderedMaterialIds: [third, second, first],
    });
    if (!programmed.ok) throw new Error(programmed.error.code);
    const afterProgramme = await load(productId);
    expect(programmed.value.orderVersion).toBe(afterProgramme.orderVersion);
    expect(afterProgramme.topics).toEqual([
      {
        id: topic,
        name: "Тема",
        summary: "",
        materialIds: afterProgramme.items.map(({ materialId }) => materialId),
      },
      { id: empty, name: "Пустая", summary: "", materialIds: [] },
    ]);

    const removed = await materials.authoring.reorderProduct({
      actor,
      productId,
      expectedOrderVersion: afterProgramme.orderVersion,
      orderedMaterialIds: afterProgramme.items
        .map(({ materialId }) => materialId)
        .filter((id) => id !== second),
    });
    if (!removed.ok) throw new Error(removed.error.code);
    const afterRemoval = await load(productId);
    expect(removed.value.orderVersion).toBe(afterRemoval.orderVersion);
    expect(afterRemoval.topics[0]?.materialIds).toEqual(
      afterRemoval.items.map(({ materialId }) => materialId),
    );
    expect(afterRemoval.topics[0]?.materialIds).not.toContain(second);

    const current = await materials.authoring.loadMaterial({
      actor,
      materialId: first,
    });
    if (!current.ok) throw new Error(current.error.code);
    const detached = await materials.authoring.saveMaterial({
      actor,
      idempotencyKey: "product-topic-detach",
      materialId: first,
      expectedContentVersion: current.value.contentVersion,
      publicationState: "published",
      metadata: {
        access: "free",
        formatId,
        difficulty: null,
        outcomes: [],
        productIds: [],
        summary: "Первый summary.",
        tagIds: [],
        title: "Первый",
        topicId,
      },
      body: representativeDocument("Первый body."),
    });
    expect(detached.ok).toBe(true);
    expect((await load(productId)).topics[0]?.materialIds).toEqual([third]);
  });

  test("the public Product page lists every topic with its published Materials", async () => {
    const slug = "topics-public";
    const productId = await product(slug);
    const lesson = await material("Опубликованный", [productId]);
    const draft = await material("Черновик", [productId], false);
    const later = await material("Ещё один", [productId]);
    const [filled, empty] = [randomUUID(), randomUUID()];
    const initial = await load(productId);
    const saved = await materials.authoring.updateProductTopics({
      actor,
      productId,
      expectedOrderVersion: initial.orderVersion,
      topics: [
        { id: empty, name: "Скоро", summary: "Готовится.", materialIds: [] },
        {
          id: filled,
          name: "Основы",
          summary: "",
          materialIds: [later, draft, lesson],
        },
      ],
    });
    if (!saved.ok) throw new Error(saved.error.code);

    const page = await materials.publishedMaterialReader.discoverProjections({
      kind: "product",
      slug,
      first: null,
    });
    if (!page.ok) throw new Error(page.error.code);
    expect(page.value.catalogueTopics).toEqual([
      { id: empty, name: "Скоро", summary: "Готовится.", materialIds: [] },
      {
        id: filled,
        name: "Основы",
        summary: "",
        materialIds: byId([lesson, later]),
      },
    ]);
    expect(page.value.catalogueTopics?.[1]?.materialIds).not.toContain(draft);

    const topicPage =
      await materials.publishedMaterialReader.discoverProjections({
        kind: "topic",
        slug: "product-topics",
        first: 10,
      });
    if (!topicPage.ok) throw new Error(topicPage.error.code);
    expect(topicPage.value.catalogueTopics).toBeUndefined();
  });
});
