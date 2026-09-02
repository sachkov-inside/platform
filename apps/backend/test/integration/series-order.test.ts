import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { assembleMaterials } from "../../src/modules/materials/index.js";
import { representativeDocument } from "../fixtures/material-body/representative.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

const actor = "89000000-0000-4000-8000-000000000001";
const topicId = "89000000-0000-4000-8000-000000000002";
const formatId = "89000000-0000-4000-8000-000000000003";
const seriesId = "89000000-0000-4000-8000-000000000004";

describe("Series order", () => {
  let testDatabase: TestDatabase;

  beforeAll(async () => {
    testDatabase = await createMigratedTestDatabase();
    await testDatabase.prisma.topic.create({
      data: { id: topicId, slug: "series-order", name: "Series order" },
    });
    await testDatabase.prisma.format.create({
      data: { id: formatId, slug: "series-guide", name: "Guide" },
    });
    await testDatabase.prisma.series.create({
      data: { id: seriesId, slug: "platform", name: "Platform" },
    });
  });

  afterAll(async () => {
    await testDatabase.dispose();
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
          idempotencyKey: `series-order-create-${index}`,
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

    for (const [index, materialId] of [firstMaterialId, thirdMaterialId].entries()) {
      const published = await authoring.saveMaterial({
        actor,
        idempotencyKey: `series-order-publish-${index}`,
        materialId,
        expectedContentVersion: 1,
        publicationState: "published",
        metadata: metadata(index === 0 ? "First" : "Third"),
        body: representativeDocument("Published body."),
      });
      if (!published.ok) throw new Error(published.error.code);
    }

    const loaded = await authoring.loadSeriesOrder({ actor, seriesId });
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
      seriesId,
    });
    expect(loaded.value.orderVersion).toMatch(/^[a-f0-9]{64}$/u);
    const reversed = [...materialIds].reverse();
    const reordered = await authoring.reorderSeries({
      actor,
      seriesId,
      expectedOrderVersion: loaded.value.orderVersion,
      orderedMaterialIds: reversed,
    });
    expect(reordered).toMatchObject({ ok: true, value: { seriesId } });
    if (!reordered.ok) throw new Error(reordered.error.code);

    expect(
      await testDatabase.prisma.seriesMembership.findMany({
        where: { seriesId },
        orderBy: { ordinal: "asc" },
        select: { materialId: true, ordinal: true },
      }),
    ).toEqual(
      reversed.map((materialId, index) => ({ materialId, ordinal: index + 1 })),
    );
    expect(
      await testDatabase.prisma.publishedMaterialSeriesMembership.findMany({
        where: { seriesId },
        orderBy: { ordinal: "asc" },
        select: { materialId: true, ordinal: true },
      }),
    ).toEqual([
      { materialId: thirdMaterialId, ordinal: 1 },
      { materialId: firstMaterialId, ordinal: 3 },
    ]);
    const versions = await testDatabase.prisma.material.findMany({
        where: { id: { in: materialIds } },
        select: { contentVersion: true, id: true },
      });
    expect(new Map(versions.map(({ contentVersion, id }) => [id, contentVersion]))).toEqual(
      new Map([
        [firstMaterialId, 2n],
        [secondMaterialId, 1n],
        [thirdMaterialId, 2n],
      ]),
    );

    await expect(
      authoring.reorderSeries({
        actor,
        seriesId,
        expectedOrderVersion: loaded.value.orderVersion,
        orderedMaterialIds: reversed,
      }),
    ).resolves.toEqual({
      ok: true,
      value: { seriesId, orderVersion: reordered.value.orderVersion },
    });
  });

  test("rejects stale order and atomically adds or removes playlist membership", async () => {
    const { authoring } = assembleMaterials({
      prisma: testDatabase.prisma,
      authorPolicy: { canManage: () => true },
    });
    const initial = await authoring.loadSeriesOrder({ actor, seriesId });
    if (!initial.ok) throw new Error(initial.error.code);
    const currentIds = initial.value.items.map(({ materialId }) => materialId);
    const [firstMaterialId, secondMaterialId] = currentIds;
    if (firstMaterialId === undefined || secondMaterialId === undefined) {
      throw new Error("Expected at least two playlist Materials");
    }
    const moved = [secondMaterialId, firstMaterialId, ...currentIds.slice(2)];
    const first = await authoring.reorderSeries({
      actor,
      seriesId,
      expectedOrderVersion: initial.value.orderVersion,
      orderedMaterialIds: moved,
    });
    if (!first.ok) throw new Error(first.error.code);

    await expect(
      authoring.reorderSeries({
        actor,
        seriesId,
        expectedOrderVersion: initial.value.orderVersion,
        orderedMaterialIds: [...moved].reverse(),
      }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: "stale_series_order",
        currentOrderVersion: first.value.orderVersion,
      },
    });

    const appended = await authoring.createDraft({
      actor,
      idempotencyKey: "series-order-membership-change",
      metadata: metadata("Appended"),
      body: representativeDocument("Appended body."),
    });
    if (!appended.ok) throw new Error(appended.error.code);
    const afterAppend = await authoring.loadSeriesOrder({ actor, seriesId });
    if (!afterAppend.ok) throw new Error(afterAppend.error.code);
    expect(afterAppend.value.items.map(({ materialId }) => materialId)).toContain(
      appended.value.materialId,
    );
    const changed = await authoring.reorderSeries({
        actor,
        seriesId,
        expectedOrderVersion: afterAppend.value.orderVersion,
        orderedMaterialIds: moved,
      });
    expect(changed).toMatchObject({ ok: true, value: { seriesId } });
    const afterRemoval = await authoring.loadSeriesOrder({ actor, seriesId });
    if (!afterRemoval.ok) throw new Error(afterRemoval.error.code);
    expect(afterRemoval.value.items.map(({ materialId }) => materialId)).toEqual(
      moved,
    );
  });

  test("serializes concurrent reorders through one optimistic order version", async () => {
    const { authoring } = assembleMaterials({
      prisma: testDatabase.prisma,
      authorPolicy: { canManage: () => true },
    });
    const initial = await authoring.loadSeriesOrder({ actor, seriesId });
    if (!initial.ok) throw new Error(initial.error.code);
    const currentIds = initial.value.items.map(({ materialId }) => materialId);
    if (currentIds.length < 3) throw new Error("Expected at least three Materials");
    const firstOrder = rotateLeft(currentIds);
    const secondOrder = rotateLeft(firstOrder);

    const results = await Promise.all([
      authoring.reorderSeries({
        actor,
        seriesId,
        expectedOrderVersion: initial.value.orderVersion,
        orderedMaterialIds: firstOrder,
      }),
      authoring.reorderSeries({
        actor,
        seriesId,
        expectedOrderVersion: initial.value.orderVersion,
        orderedMaterialIds: secondOrder,
      }),
    ]);

    expect(results.filter(({ ok }) => ok)).toHaveLength(1);
    const rejected = results.find(({ ok }) => !ok);
    expect(rejected).toMatchObject({
      ok: false,
      error: { code: "stale_series_order" },
    });
  });

  test("keeps archived composition editable but rejects new assignments", async () => {
    const { authoring } = assembleMaterials({
      prisma: testDatabase.prisma,
      authorPolicy: { canManage: () => true },
    });
    const unassigned = await authoring.createDraft({
      actor,
      idempotencyKey: "series-order-archived-unassigned",
      metadata: { ...metadata("Unassigned"), seriesIds: [] },
      body: representativeDocument("Unassigned body."),
    });
    if (!unassigned.ok) throw new Error(unassigned.error.code);
    await testDatabase.prisma.series.update({
      where: { id: seriesId },
      data: { archivedAt: new Date() },
    });
    try {
      const loaded = await authoring.loadSeriesOrder({ actor, seriesId });
      if (!loaded.ok) throw new Error(loaded.error.code);
      expect(loaded.value.archived).toBe(true);
      const currentIds = loaded.value.items.map(({ materialId }) => materialId);
      const reordered = await authoring.reorderSeries({
        actor,
        seriesId,
        expectedOrderVersion: loaded.value.orderVersion,
        orderedMaterialIds: rotateLeft(currentIds),
      });
      if (!reordered.ok) throw new Error(reordered.error.code);

      await expect(
        authoring.reorderSeries({
          actor,
          seriesId,
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
              code: "series_archived",
              path: `/orderedMaterialIds/${String(currentIds.length)}`,
            },
          ],
        },
      });
    } finally {
      await testDatabase.prisma.series.update({
        where: { id: seriesId },
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
      idempotencyKey: "series-order-concurrent-save-create",
      metadata: metadata("Concurrent save"),
      body: representativeDocument("Concurrent save body."),
    });
    if (!savedDraft.ok) throw new Error(savedDraft.error.code);
    const beforeSave = await authoring.loadSeriesOrder({ actor, seriesId });
    if (!beforeSave.ok) throw new Error(beforeSave.error.code);
    const beforeSaveIds = beforeSave.value.items.map(({ materialId }) => materialId);
    const saveOrder = rotateLeft(beforeSaveIds);
    const [saved, reorderedWithSave] = await Promise.all([
      authoring.saveMaterial({
        actor,
        idempotencyKey: "series-order-concurrent-save",
        materialId: savedDraft.value.materialId,
        expectedContentVersion: 1,
        publicationState: "draft",
        metadata: metadata("Concurrent save"),
        body: representativeDocument("Saved concurrently with reorder."),
      }),
      authoring.reorderSeries({
        actor,
        seriesId,
        expectedOrderVersion: beforeSave.value.orderVersion,
        orderedMaterialIds: saveOrder,
      }),
    ]);
    expect(saved.ok).toBe(true);
    expect(reorderedWithSave.ok).toBe(true);

    const deletedDraft = await authoring.createDraft({
      actor,
      idempotencyKey: "series-order-concurrent-delete-create",
      metadata: metadata("Concurrent delete"),
      body: representativeDocument("Concurrent delete body."),
    });
    if (!deletedDraft.ok) throw new Error(deletedDraft.error.code);
    const beforeDelete = await authoring.loadSeriesOrder({ actor, seriesId });
    if (!beforeDelete.ok) throw new Error(beforeDelete.error.code);
    const beforeDeleteIds = beforeDelete.value.items.map(({ materialId }) => materialId);
    const deleteOrder = rotateLeft(beforeDeleteIds);
    const [deleted, reorderedWithDelete] = await Promise.all([
      authoring.deleteDraft({
        actor,
        idempotencyKey: "series-order-concurrent-delete",
        materialId: deletedDraft.value.materialId,
        expectedContentVersion: 1,
      }),
      authoring.reorderSeries({
        actor,
        seriesId,
        expectedOrderVersion: beforeDelete.value.orderVersion,
        orderedMaterialIds: deleteOrder,
      }),
    ]);
    expect(deleted.ok).toBe(true);
    if (!reorderedWithDelete.ok) {
      expect(reorderedWithDelete.error.code).toBe("stale_series_order");
    }
  });

  test("protects playlist management and reports a missing playlist", async () => {
    const { authoring } = assembleMaterials({
      prisma: testDatabase.prisma,
      authorPolicy: { canManage: (accountId) => accountId === actor },
    });
    await expect(
      authoring.loadSeriesOrder({
        actor: "89000000-0000-4000-8000-000000000099",
        seriesId,
      }),
    ).resolves.toEqual({ ok: false, error: { code: "forbidden" } });
    await expect(
      authoring.loadSeriesOrder({
        actor,
        seriesId: "89000000-0000-4000-8000-000000000099",
      }),
    ).resolves.toEqual({ ok: false, error: { code: "series_not_found" } });
  });
});

function metadata(title: string) {
  return {
    access: "free" as const,
    formatId,
    seriesIds: [seriesId],
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
