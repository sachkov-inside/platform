import { ProductDiscovery } from "../../src/modules/products/index.js";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import {
  assembleProductAuthoring,
  ProductCompositions,
} from "../../src/modules/products/index.js";
import { assembleProductMaterials } from "../../src/modules/materials/index.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

let database: TestDatabase;
beforeAll(async () => {
  database = await createMigratedTestDatabase();
});
afterAll(async () => {
  await database.dispose();
});

test("Product authoring preserves repeated programme identities separately from catalogue and attachments", async () => {
  const actor = randomUUID();
  const materialId = randomUUID();
  await database.prisma.material.create({
    data: {
      id: materialId,
      createdBy: actor,
      body: { type: "doc", content: [] },
      schemaVersion: 1,
      access: "free",
      publicationState: "draft",
      contentVersion: 1n,
    },
  });
  const materials = assembleProductMaterials(
    database.prisma,
    new ProductDiscovery(database.prisma),
  );
  const authoring = assembleProductAuthoring({
    prisma: database.prisma,
    authorPolicy: { canManage: () => true },
    materials,
    loadCovers: () => Promise.resolve(new Map()),
  });
  const product = await authoring.createContentCollection({
    actor,
    kind: "product",
    slug: "explicit-programme",
    name: "Explicit programme",
    summary: "Catalogue and repeated placements",
  });
  if (!product.ok) throw new Error(product.error.code);
  const empty = await authoring.loadSeriesOrder({
    actor,
    seriesId: product.value.id,
  });
  if (!empty.ok) throw new Error(empty.error.code);
  const chapterId = randomUUID();
  const first = randomUUID();
  const repeated = randomUUID();
  const ordered = await authoring.reorderSeries({
    actor,
    seriesId: product.value.id,
    expectedOrderVersion: empty.value.orderVersion,
    orderedMaterialIds: [materialId],
    chapters: [
      {
        id: chapterId,
        name: "Chapter",
        summary: "Description",
        supplementaryMaterialIds: [materialId],
      },
    ],
    programmePlacements: [
      { id: first, materialId, chapterId, stepGroup: "Read" },
      { id: repeated, materialId, chapterId, stepGroup: "Repeat" },
    ],
  });
  if (!ordered.ok) throw new Error(ordered.error.code);
  const loaded = await authoring.loadSeriesOrder({
    actor,
    seriesId: product.value.id,
  });
  if (!loaded.ok) throw new Error(loaded.error.code);
  expect(loaded.value.items.map((item) => item.materialId)).toEqual([
    materialId,
  ]);
  expect(loaded.value.programmePlacements).toEqual([
    { id: first, materialId, chapterId, stepGroup: "Read" },
    { id: repeated, materialId, chapterId, stepGroup: "Repeat" },
  ]);
  expect(loaded.value.chapters[0]?.supplementaryMaterialIds).toEqual([
    materialId,
  ]);
  const compositions = await new ProductCompositions(database.prisma).load(
    { ids: [product.value.id] },
    1,
    {
      async load(ids) {
        return (await materials.load(ids)).map((row) => ({
          id: row.id,
          sourceId: row.sourceId,
          published: row.publicationState === "published",
          topicId: row.topicId,
          hasModeVariants: row.hasModeVariants,
        }));
      },
    },
  );
  expect(
    compositions[0]?.programmePlacements.map((placement) => placement.id),
  ).toEqual([first, repeated]);
  expect(compositions[0]?.materials).toEqual([]);
  const invalid = await authoring.reorderSeries({
    actor,
    seriesId: product.value.id,
    expectedOrderVersion: ordered.value.orderVersion,
    orderedMaterialIds: [materialId, randomUUID()],
    chapters: loaded.value.chapters.map(
      ({ id, name, summary, supplementaryMaterialIds }) => ({
        id,
        name,
        summary,
        supplementaryMaterialIds:
          supplementaryMaterialIds === undefined
            ? undefined
            : [...supplementaryMaterialIds],
      }),
    ),
    programmePlacements: loaded.value.programmePlacements,
  });
  expect(invalid).toMatchObject({
    ok: false,
    error: { code: "invalid_reference" },
  });
  expect(
    await authoring.loadSeriesOrder({ actor, seriesId: product.value.id }),
  ).toEqual(loaded);
});

test("Product writes authorize through the same transaction handle as persistence", async () => {
  const actor = randomUUID();
  const authoring = assembleProductAuthoring({
    prisma: database.prisma,
    authorPolicy: { canManage: (_accountId, handle) => handle !== undefined },
    materials: assembleProductMaterials(
      database.prisma,
      new ProductDiscovery(database.prisma),
    ),
    loadCovers: () => Promise.resolve(new Map()),
  });
  const product = await authoring.createContentCollection({
    actor,
    kind: "product",
    slug: "transaction-authorized",
    name: "Transaction permission",
    summary: "Same connection",
  });
  expect(product.ok).toBe(true);
  if (!product.ok) throw new Error(product.error.code);
  expect(
    await authoring.updateContentCollection({
      actor,
      kind: "product",
      collectionId: product.value.id,
      expectedVersion: product.value.version,
      name: "Changed under permission",
      summary: "Same connection",
    }),
  ).toMatchObject({ ok: true });
});

test("concurrent Product source reservation returns one stable identity", async () => {
  const authoring = assembleProductAuthoring({
    prisma: database.prisma,
    authorPolicy: { canManage: (_accountId, handle) => handle !== undefined },
    materials: assembleProductMaterials(
      database.prisma,
      new ProductDiscovery(database.prisma),
    ),
    loadCovers: () => Promise.resolve(new Map()),
  });
  const command = {
    actor: randomUUID(),
    sourceId: "concurrent-product-source",
    slug: "concurrent-source",
    name: "Concurrent source",
    summary: "One Product",
  };
  const results = await Promise.all([
    authoring.reserveSourceProduct(command),
    authoring.reserveSourceProduct(command),
  ]);
  expect(results.every((result) => result.ok)).toBe(true);
  expect(
    new Set(results.flatMap((result) => (result.ok ? [result.value.id] : []))),
  ).toHaveLength(1);
});
