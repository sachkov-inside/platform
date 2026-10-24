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
  // Each round reserves a fresh source, exercising competing first inserts rather than replay.
  for (let round = 0; round < 200; round++) {
    const command = {
      actor: randomUUID(),
      sourceId: `concurrent-product-source:${round}`,
      slug: `concurrent-source-${round}`,
      name: "Concurrent source",
      summary: "One Product",
    };
    const results = await Promise.all(
      Array.from({ length: 8 }, () => authoring.reserveSourceProduct(command)),
    );
    expect(results.every((result) => result.ok)).toBe(true);
    expect(
      new Set(
        results.flatMap((result) => (result.ok ? [result.value.id] : [])),
      ),
    ).toHaveLength(1);
  }
});

test("Product source replay preserves its original identity and metadata", async () => {
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
    sourceId: "stable-product-source",
    slug: "original-source-slug",
    name: "Original source",
    summary: "Original description",
  };
  const original = await authoring.reserveSourceProduct(command);
  expect(original.ok).toBe(true);
  const replay = await authoring.reserveSourceProduct({
    ...command,
    slug: "ignored-replay-slug",
    name: "Ignored replay name",
    summary: "Ignored replay description",
  });
  expect(replay).toEqual(original);
});

test("different Product sources competing for one slug retain a real conflict", async () => {
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
    slug: "competing-source-slug",
    name: "Competing source",
    summary: "One slug has one owner",
  };
  const results = await Promise.all([
    authoring.reserveSourceProduct({
      ...command,
      sourceId: "competing-source-a",
    }),
    authoring.reserveSourceProduct({
      ...command,
      sourceId: "competing-source-b",
    }),
  ]);
  expect(results.filter((result) => result.ok)).toHaveLength(1);
  expect(results.filter((result) => !result.ok)).toEqual([
    { ok: false, error: { code: "content_collection_slug_conflict" } },
  ]);
  for (const sourceId of ["competing-source-a", "competing-source-b"]) {
    const replay = await authoring.reserveSourceProduct({
      ...command,
      sourceId,
    });
    const original = results.find(
      (result) => result.ok && result.value.sourceId === sourceId,
    );
    expect(replay).toEqual(
      original ?? {
        ok: false,
        error: { code: "content_collection_slug_conflict" },
      },
    );
  }
});

test("a forbidden Product reservation cannot claim a source or slug", async () => {
  const actor = randomUUID();
  const manager = randomUUID();
  const authoring = assembleProductAuthoring({
    prisma: database.prisma,
    authorPolicy: {
      canManage: (accountId, handle) =>
        accountId === manager && handle !== undefined,
    },
    materials: assembleProductMaterials(
      database.prisma,
      new ProductDiscovery(database.prisma),
    ),
    loadCovers: () => Promise.resolve(new Map()),
  });
  const command = {
    sourceId: "permission-product-source",
    slug: "permission-source-slug",
    name: "Unauthorized source",
    summary: "Cannot reserve",
  };
  expect(await authoring.reserveSourceProduct({ ...command, actor })).toEqual({
    ok: false,
    error: { code: "forbidden" },
  });
  expect(
    await authoring.reserveSourceProduct({
      ...command,
      actor: manager,
      name: "Authorized source",
    }),
  ).toMatchObject({ ok: true, value: { name: "Authorized source" } });
});
