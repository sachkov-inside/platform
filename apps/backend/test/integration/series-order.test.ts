import { authorProductProgramme } from "../fixtures/author-product-programme.js";
import { registerFixedClock } from "../support/fixed-clock.js";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { assembleMaterials } from "../../src/entrypoints/composition/assemble-materials.js";
import { representativeDocument } from "../fixtures/material-body/representative.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

registerFixedClock();

const actor = "89000000-0000-4000-8000-000000000001";
const topicId = "89000000-0000-4000-8000-000000000002";
const formatId = "guide";
const productId = "89000000-0000-4000-8000-000000000004";

describe("Product order", () => {
  let testDatabase: TestDatabase;

  beforeAll(async () => {
    testDatabase = await createMigratedTestDatabase();
    await testDatabase.prisma.topic.create({
      data: { id: topicId, slug: "product-order", name: "Product order" },
    });

    await testDatabase.prisma.product.create({
      data: { id: productId, slug: "platform", name: "Platform" },
    });
  });

  afterAll(async () => {
    await testDatabase.dispose();
  });

  test("Products owns its catalogue separately from Materials", async () => {
    const { Prisma } = await import("../../src/infrastructure/prisma/index.js");
    const rows = await testDatabase.prisma.$queryRaw(Prisma.sql`
      select table_schema as schema from information_schema.tables
      where table_name = 'products' and table_schema in ('materials', 'products')
    `);
    expect(rows).toEqual([{ schema: "products" }]);
  });

  test("Product and legacy Product share identity, mutable version and archive state", async () => {
    const { authoring } = assembleMaterials({
      prisma: testDatabase.prisma,
      authorPolicy: { canManage: () => true },
    });
    const created = await authoring.createContentCollection({
      actor,
      kind: "product",
      name: "Reusable Product",
      slug: "reusable-product",
      summary: "One product",
    });
    if (!created.ok) throw new Error(created.error.code);
    expect(created.value.kind).toBe("product");
    const legacy = await authoring.listContentCollections({
      actor,
      kind: "product",
    });
    if (!legacy.ok) throw new Error(legacy.error.code);
    expect(legacy.value.find(({ id }) => id === created.value.id)).toEqual({
      ...created.value,
      kind: "product",
      // The list row adds the holder count; this assembly has no holder reads.
      holderCount: null,
    });
    const archived = await authoring.setContentCollectionArchive({
      actor,
      kind: "product",
      collectionId: created.value.id,
      expectedVersion: created.value.version,
      archived: true,
    });
    if (!archived.ok) throw new Error(archived.error.code);
    const products = await authoring.listContentCollections({
      actor,
      kind: "product",
    });
    if (!products.ok) throw new Error(products.error.code);
    expect(
      products.value.find(({ id }) => id === created.value.id),
    ).toMatchObject({
      kind: "product",
      archived: true,
      slug: "reusable-product",
      version: created.value.version + 1,
    });
    expect(
      await testDatabase.prisma.product.count({
        where: { id: created.value.id },
      }),
    ).toBe(1);
  });

  test("loads and reorders a playlist without changing Material versions", async () => {
    const { authoring } = assembleMaterials({
      prisma: testDatabase.prisma,
      authorPolicy: { canManage: () => true },
    });
    const created: Awaited<ReturnType<typeof authoring.createDraft>>[] = [];
    for (const [index, title] of ["First", "Second", "Third"].entries()) {
      created.push(
        await authoring.createDraft({
          actor,
          idempotencyKey: `product-order-create-${index}`,
          metadata: metadata(title),
          body: representativeDocument(`${title} body.`),
        }),
      );
    }
    const materialIds = created.map((result) => {
      if (!result.ok) throw new Error(result.error.code);
      return result.value.materialId;
    });
    const [firstMaterialId, secondMaterialId, thirdMaterialId] = materialIds;
    if (
      firstMaterialId === undefined ||
      secondMaterialId === undefined ||
      thirdMaterialId === undefined
    ) {
      throw new Error("Expected three created Materials");
    }

    for (const [index, materialId] of [
      firstMaterialId,
      thirdMaterialId,
    ].entries()) {
      const published = await authoring.saveMaterial({
        actor,
        idempotencyKey: `product-order-publish-${index}`,
        materialId,
        expectedContentVersion: 1,
        publicationState: "published",
        metadata: metadata(index === 0 ? "First" : "Third"),
        body: representativeDocument("Published body."),
      });
      if (!published.ok) throw new Error(published.error.code);
    }

    const catalogue = await authoring.loadProductOrder({ actor, productId });
    if (!catalogue.ok) throw new Error(catalogue.error.code);
    expect(catalogue.value.programmePlacements).toEqual([]);
    const programme = await authorProductProgramme(authoring, {
      actor,
      productId,
      expectedOrderVersion: catalogue.value.orderVersion,
      orderedMaterialIds: materialIds,
    });
    if (!programme.ok) throw new Error(programme.error.code);
    const loaded = await authoring.loadProductOrder({ actor, productId });
    if (!loaded.ok) throw new Error(loaded.error.code);
    expect(loaded.value).toMatchObject({
      items: [
        {
          materialId: firstMaterialId,
          ordinal: 1,
          publicationState: "published",
          title: "First",
        },
        {
          materialId: secondMaterialId,
          ordinal: 2,
          publicationState: "draft",
          title: "Second",
        },
        {
          materialId: thirdMaterialId,
          ordinal: 3,
          publicationState: "published",
          title: "Third",
        },
      ],
      name: "Platform",
      orderVersion: loaded.value.orderVersion,
      productId,
    });
    expect(loaded.value.orderVersion).toMatch(/^[a-f0-9]{64}$/u);
    const reversed = [...materialIds].reverse();
    const reordered = await authorProductProgramme(authoring, {
      actor,
      productId,
      expectedOrderVersion: loaded.value.orderVersion,
      orderedMaterialIds: reversed,
    });
    expect(reordered).toMatchObject({ ok: true, value: { productId } });
    if (!reordered.ok) throw new Error(reordered.error.code);

    const after = await authoring.loadProductOrder({ actor, productId });
    if (!after.ok) throw new Error(after.error.code);
    expect(
      after.value.programmePlacements.map((placement) => placement.materialId),
    ).toEqual(reversed);
    expect(
      after.value.items
        .filter((item) => item.publicationState === "published")
        .map(({ materialId, ordinal }) => ({ materialId, ordinal })),
    ).toEqual([
      { materialId: thirdMaterialId, ordinal: 1 },
      { materialId: firstMaterialId, ordinal: 3 },
    ]);
    const versions = await testDatabase.prisma.material.findMany({
      where: { id: { in: materialIds } },
      select: { contentVersion: true, id: true },
    });
    expect(
      new Map(versions.map(({ contentVersion, id }) => [id, contentVersion])),
    ).toEqual(
      new Map([
        [firstMaterialId, 2n],
        [secondMaterialId, 1n],
        [thirdMaterialId, 2n],
      ]),
    );

    await expect(
      authorProductProgramme(authoring, {
        actor,
        productId,
        expectedOrderVersion: loaded.value.orderVersion,
        orderedMaterialIds: reversed,
      }),
    ).resolves.toEqual({
      ok: true,
      value: { productId, orderVersion: reordered.value.orderVersion },
    });
  });

  test("rejects stale order and atomically adds or removes playlist membership", async () => {
    const { authoring } = assembleMaterials({
      prisma: testDatabase.prisma,
      authorPolicy: { canManage: () => true },
    });
    const initial = await authoring.loadProductOrder({ actor, productId });
    if (!initial.ok) throw new Error(initial.error.code);
    const currentIds = initial.value.items.map(({ materialId }) => materialId);
    const [firstMaterialId, secondMaterialId] = currentIds;
    if (firstMaterialId === undefined || secondMaterialId === undefined) {
      throw new Error("Expected at least two playlist Materials");
    }
    const moved = [secondMaterialId, firstMaterialId, ...currentIds.slice(2)];
    const first = await authorProductProgramme(authoring, {
      actor,
      productId,
      expectedOrderVersion: initial.value.orderVersion,
      orderedMaterialIds: moved,
    });
    if (!first.ok) throw new Error(first.error.code);

    await expect(
      authorProductProgramme(authoring, {
        actor,
        productId,
        expectedOrderVersion: initial.value.orderVersion,
        orderedMaterialIds: [...moved].reverse(),
      }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: "stale_product_order",
        currentOrderVersion: first.value.orderVersion,
      },
    });

    const appended = await authoring.createDraft({
      actor,
      idempotencyKey: "product-order-membership-change",
      metadata: metadata("Appended"),
      body: representativeDocument("Appended body."),
    });
    if (!appended.ok) throw new Error(appended.error.code);
    const afterAppend = await authoring.loadProductOrder({ actor, productId });
    if (!afterAppend.ok) throw new Error(afterAppend.error.code);
    expect(
      afterAppend.value.items.map(({ materialId }) => materialId),
    ).toContain(appended.value.materialId);
    const changed = await authorProductProgramme(authoring, {
      actor,
      productId,
      expectedOrderVersion: afterAppend.value.orderVersion,
      orderedMaterialIds: moved,
    });
    expect(changed).toMatchObject({ ok: true, value: { productId } });
    const afterRemoval = await authoring.loadProductOrder({ actor, productId });
    if (!afterRemoval.ok) throw new Error(afterRemoval.error.code);
    expect(
      afterRemoval.value.items.map(({ materialId }) => materialId),
    ).toEqual(moved);
  });

  test("keeps one Material in a second Product when the author removes it from the first", async () => {
    const { authoring } = assembleMaterials({
      prisma: testDatabase.prisma,
      authorPolicy: { canManage: () => true },
    });
    const [firstProduct, secondProduct] = await Promise.all([
      authoring.createContentCollection({
        actor,
        kind: "product",
        name: "First independent Product",
        slug: "first-independent-product",
        summary: "First explicit order.",
      }),
      authoring.createContentCollection({
        actor,
        kind: "product",
        name: "Second independent Product",
        slug: "second-independent-product",
        summary: "Second explicit order.",
      }),
    ]);
    if (!firstProduct.ok || !secondProduct.ok) {
      throw new Error("Expected two Product");
    }
    const shared = await authoring.createDraft({
      actor,
      idempotencyKey: "product-order-shared-material",
      metadata: {
        ...metadata("Shared Material"),
        productIds: [firstProduct.value.id, secondProduct.value.id],
      },
      body: representativeDocument("Shared body."),
    });
    if (!shared.ok) throw new Error(shared.error.code);

    const firstOrder = await authoring.loadProductOrder({
      actor,
      productId: firstProduct.value.id,
    });
    if (!firstOrder.ok) throw new Error(firstOrder.error.code);
    const removed = await authoring.reorderProduct({
      actor,
      expectedOrderVersion: firstOrder.value.orderVersion,
      orderedMaterialIds: [],
      productId: firstProduct.value.id,
    });
    if (!removed.ok) throw new Error(removed.error.code);

    const [firstAfterRemoval, secondAfterRemoval, material] = await Promise.all(
      [
        authoring.loadProductOrder({ actor, productId: firstProduct.value.id }),
        authoring.loadProductOrder({
          actor,
          productId: secondProduct.value.id,
        }),
        authoring.loadMaterial({ actor, materialId: shared.value.materialId }),
      ],
    );
    if (!firstAfterRemoval.ok || !secondAfterRemoval.ok || !material.ok) {
      throw new Error("Expected preserved Material and Product");
    }
    expect(firstAfterRemoval.value.items).toEqual([]);
    expect(secondAfterRemoval.value.items).toMatchObject([
      { materialId: shared.value.materialId, ordinal: 1 },
    ]);
    expect(material.value.metadata.productMemberships).toEqual([
      { ordinal: 1, productId: secondProduct.value.id },
    ]);
  });

  test("serializes concurrent reorders through one optimistic order version", async () => {
    const { authoring } = assembleMaterials({
      prisma: testDatabase.prisma,
      authorPolicy: { canManage: () => true },
    });
    const initial = await authoring.loadProductOrder({ actor, productId });
    if (!initial.ok) throw new Error(initial.error.code);
    const currentIds = initial.value.items.map(({ materialId }) => materialId);
    if (currentIds.length < 3)
      throw new Error("Expected at least three Materials");
    const firstOrder = rotateLeft(currentIds);
    const secondOrder = rotateLeft(firstOrder);

    const results = await Promise.all([
      authorProductProgramme(authoring, {
        actor,
        productId,
        expectedOrderVersion: initial.value.orderVersion,
        orderedMaterialIds: firstOrder,
      }),
      authorProductProgramme(authoring, {
        actor,
        productId,
        expectedOrderVersion: initial.value.orderVersion,
        orderedMaterialIds: secondOrder,
      }),
    ]);

    expect(results.filter(({ ok }) => ok)).toHaveLength(1);
    const rejected = results.find(({ ok }) => !ok);
    expect(rejected).toMatchObject({
      ok: false,
      error: { code: "stale_product_order" },
    });
  });

  test("keeps archived composition editable but rejects new assignments", async () => {
    const { authoring } = assembleMaterials({
      prisma: testDatabase.prisma,
      authorPolicy: { canManage: () => true },
    });
    const unassigned = await authoring.createDraft({
      actor,
      idempotencyKey: "product-order-archived-unassigned",
      metadata: { ...metadata("Unassigned"), productIds: [] },
      body: representativeDocument("Unassigned body."),
    });
    if (!unassigned.ok) throw new Error(unassigned.error.code);
    await testDatabase.prisma.product.update({
      where: { id: productId },
      // deterministic-test-allow wall-clock: Date is fixed per case by registerFixedClock; production consumers share this virtual Date.
      data: { archivedAt: new Date() },
    });
    try {
      const loaded = await authoring.loadProductOrder({ actor, productId });
      if (!loaded.ok) throw new Error(loaded.error.code);
      expect(loaded.value.archived).toBe(true);
      const currentIds = loaded.value.items.map(({ materialId }) => materialId);
      const reordered = await authoring.reorderProduct({
        actor,
        productId,
        expectedOrderVersion: loaded.value.orderVersion,
        orderedMaterialIds: rotateLeft(currentIds),
      });
      if (!reordered.ok) throw new Error(reordered.error.code);

      await expect(
        authoring.reorderProduct({
          actor,
          productId,
          expectedOrderVersion: reordered.value.orderVersion,
          orderedMaterialIds: [
            ...rotateLeft(currentIds),
            unassigned.value.materialId,
          ],
        }),
      ).resolves.toEqual({
        ok: false,
        error: {
          code: "invalid_reference",
          issues: [
            {
              code: "product_archived",
              path: `/orderedMaterialIds/${String(currentIds.length)}`,
            },
          ],
        },
      });
    } finally {
      await testDatabase.prisma.product.update({
        where: { id: productId },
        data: { archivedAt: null },
      });
    }
  });

  test("uses one lock order for concurrent save, delete, and playlist reorder", async () => {
    const { authoring } = assembleMaterials({
      prisma: testDatabase.prisma,
      authorPolicy: { canManage: () => true },
    });
    const savedDraft = await authoring.createDraft({
      actor,
      idempotencyKey: "product-order-concurrent-save-create",
      metadata: metadata("Concurrent save"),
      body: representativeDocument("Concurrent save body."),
    });
    if (!savedDraft.ok) throw new Error(savedDraft.error.code);
    const beforeSave = await authoring.loadProductOrder({ actor, productId });
    if (!beforeSave.ok) throw new Error(beforeSave.error.code);
    const beforeSaveIds = beforeSave.value.items.map(
      ({ materialId }) => materialId,
    );
    const saveOrder = rotateLeft(beforeSaveIds);
    const [saved, reorderedWithSave] = await Promise.all([
      authoring.saveMaterial({
        actor,
        idempotencyKey: "product-order-concurrent-save",
        materialId: savedDraft.value.materialId,
        expectedContentVersion: 1,
        publicationState: "draft",
        metadata: metadata("Concurrent save"),
        body: representativeDocument("Saved concurrently with reorder."),
      }),
      authoring.reorderProduct({
        actor,
        productId,
        expectedOrderVersion: beforeSave.value.orderVersion,
        orderedMaterialIds: saveOrder,
      }),
    ]);
    expect(saved.ok).toBe(true);
    expect(reorderedWithSave.ok).toBe(true);

    const deletedDraft = await authoring.createDraft({
      actor,
      idempotencyKey: "product-order-concurrent-delete-create",
      metadata: metadata("Concurrent delete"),
      body: representativeDocument("Concurrent delete body."),
    });
    if (!deletedDraft.ok) throw new Error(deletedDraft.error.code);
    const beforeDelete = await authoring.loadProductOrder({ actor, productId });
    if (!beforeDelete.ok) throw new Error(beforeDelete.error.code);
    const beforeDeleteIds = beforeDelete.value.items.map(
      ({ materialId }) => materialId,
    );
    const deleteOrder = rotateLeft(beforeDeleteIds);
    const [deleted, reorderedWithDelete] = await Promise.all([
      authoring.deleteDraft({
        actor,
        idempotencyKey: "product-order-concurrent-delete",
        materialId: deletedDraft.value.materialId,
        expectedContentVersion: 1,
      }),
      authoring.reorderProduct({
        actor,
        productId,
        expectedOrderVersion: beforeDelete.value.orderVersion,
        orderedMaterialIds: deleteOrder,
      }),
    ]);
    expect(deleted.ok).toBe(true);
    if (!reorderedWithDelete.ok) {
      expect(reorderedWithDelete.error.code).toBe("stale_product_order");
    }
  });

  test("round-trips Product-scoped step labels, preserves legacy writes and excludes drafts", async () => {
    const { authoring, publishedMaterialReader } = assembleMaterials({
      prisma: testDatabase.prisma,
      authorPolicy: { canManage: () => true },
    });
    const collection = await authoring.createContentCollection({
      actor,
      kind: "product",
      slug: "step-labels",
      name: "Step labels",
      summary: "Mixed composition",
    });
    if (!collection.ok) throw new Error(collection.error.code);
    const selectedProductId = collection.value.id;
    const ids: string[] = [];
    for (const [index, title] of [
      "Prepare",
      "Video",
      "Hidden step",
      "Deploy",
    ].entries()) {
      const created = await authoring.createDraft({
        actor,
        idempotencyKey: `step-label-${index}`,
        metadata: {
          ...metadata(title),
          productIds: [selectedProductId, productId],
        },
        body: representativeDocument(title),
      });
      if (!created.ok) throw new Error(created.error.code);
      ids.push(created.value.materialId);
      if (index !== 2) {
        const published = await authoring.saveMaterial({
          actor,
          idempotencyKey: `step-publish-${index}`,
          materialId: created.value.materialId,
          expectedContentVersion: 1,
          publicationState: "published",
          metadata: {
            ...metadata(title),
            productIds: [selectedProductId, productId],
          },
          body: representativeDocument(title),
        });
        if (!published.ok) throw new Error(published.error.code);
      }
    }
    const first = ids[0];
    const hidden = ids[2];
    const last = ids[3];
    if (first === undefined || hidden === undefined || last === undefined)
      throw new Error("Expected four Materials");
    const initial = await authoring.loadProductOrder({
      actor,
      productId: selectedProductId,
    });
    if (!initial.ok) throw new Error(initial.error.code);
    const grouped = await authorProductProgramme(authoring, {
      actor,
      productId: selectedProductId,
      expectedOrderVersion: initial.value.orderVersion,
      orderedMaterialIds: ids,
      stepGroups: {
        [first]: "  Release  ",
        [hidden]: "Hidden-only label",
        [last]: "Release",
      },
    });
    if (!grouped.ok) throw new Error(grouped.error.code);
    expect(grouped.value.orderVersion).not.toBe(initial.value.orderVersion);
    const loaded = await authoring.loadProductOrder({
      actor,
      productId: selectedProductId,
    });
    if (!loaded.ok) throw new Error(loaded.error.code);
    expect(loaded.value.items.map(({ stepGroup }) => stepGroup)).toEqual([
      "Release",
      null,
      "Hidden-only label",
      "Release",
    ]);
    const publicProduct = await publishedMaterialReader.discoverProjections({
      kind: "product",
      slug: "step-labels",
      first: null,
    });
    if (!publicProduct.ok) throw new Error(publicProduct.error.code);
    expect(
      publicProduct.value.items.map(({ materialId }) => materialId),
    ).toEqual([first, ids[1], last]);
    expect(JSON.stringify(publicProduct.value)).not.toContain(
      "Hidden-only label",
    );
    expect(
      publicProduct.value.items[0]?.productMemberships.find(
        ({ product }) => product.id === productId,
      )?.stepGroup,
    ).toBeNull();
    expect(
      publicProduct.value.items[0]?.productMemberships.find(
        ({ product }) => product.id === selectedProductId,
      )?.stepGroup,
    ).toBe("Release");
    const stale = await authorProductProgramme(authoring, {
      actor,
      productId: selectedProductId,
      expectedOrderVersion: initial.value.orderVersion,
      orderedMaterialIds: ids,
      stepGroups: {},
    });
    expect(stale).toMatchObject({
      ok: false,
      error: { code: "stale_product_order" },
    });
    const saved = await authoring.loadMaterial({ actor, materialId: first });
    if (!saved.ok) throw new Error(saved.error.code);
    const resaved = await authoring.saveMaterial({
      actor,
      idempotencyKey: "step-resave",
      materialId: first,
      expectedContentVersion: saved.value.contentVersion,
      publicationState: "published",
      metadata: {
        ...metadata("Prepare"),
        productIds: [selectedProductId, productId],
      },
      body: representativeDocument("Edited body"),
    });
    if (!resaved.ok) throw new Error(resaved.error.code);
    const legacy = await authorProductProgramme(authoring, {
      actor,
      productId: selectedProductId,
      expectedOrderVersion: grouped.value.orderVersion,
      orderedMaterialIds: [last, first],
    });
    if (!legacy.ok) throw new Error(legacy.error.code);
    const afterLegacy = await authoring.loadProductOrder({
      actor,
      productId: selectedProductId,
    });
    if (!afterLegacy.ok) throw new Error(afterLegacy.error.code);
    expect(
      afterLegacy.value.items.map(({ materialId, stepGroup }) => [
        materialId,
        stepGroup,
      ]),
    ).toEqual([
      [last, "Release"],
      [first, "Release"],
    ]);
    for (const stepGroups of [
      { [hidden]: "Gone" },
      { [first]: " " },
      { [first]: "x".repeat(121) },
    ]) {
      expect(
        await authorProductProgramme(authoring, {
          actor,
          productId: selectedProductId,
          expectedOrderVersion: legacy.value.orderVersion,
          orderedMaterialIds: [last, first],
          stepGroups,
        }),
      ).toMatchObject({ ok: false, error: { code: "invalid_content" } });
    }
    const cleared = await authorProductProgramme(authoring, {
      actor,
      productId: selectedProductId,
      expectedOrderVersion: legacy.value.orderVersion,
      orderedMaterialIds: [last, first],
      stepGroups: {},
    });
    expect(cleared.ok).toBe(true);
    const afterClear = await authoring.loadProductOrder({
      actor,
      productId: selectedProductId,
    });
    if (!afterClear.ok) throw new Error(afterClear.error.code);
    expect(afterClear.value.items.map(({ stepGroup }) => stepGroup)).toEqual([
      null,
      null,
    ]);
  });

  test("protects playlist management and reports a missing playlist", async () => {
    const { authoring } = assembleMaterials({
      prisma: testDatabase.prisma,
      authorPolicy: { canManage: (accountId) => accountId === actor },
    });
    await expect(
      authoring.loadProductOrder({
        actor: "89000000-0000-4000-8000-000000000099",
        productId,
      }),
    ).resolves.toEqual({ ok: false, error: { code: "forbidden" } });
    await expect(
      authoring.loadProductOrder({
        actor,
        productId: "89000000-0000-4000-8000-000000000099",
      }),
    ).resolves.toEqual({ ok: false, error: { code: "product_not_found" } });
  });
});

function metadata(title: string) {
  return {
    access: "free" as const,
    formatId,
    difficulty: null,
    outcomes: [],
    productIds: [productId],
    summary: `${title} summary.`,
    tagIds: [],
    title,
    topicId,
  };
}

function rotateLeft(values: readonly string[]): readonly string[] {
  const [first, ...rest] = values;
  if (first === undefined) throw new Error("Expected at least one Material");
  return [...rest, first];
}
