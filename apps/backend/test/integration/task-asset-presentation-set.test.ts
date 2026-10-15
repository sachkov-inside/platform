import { afterAll, beforeAll, expect, test } from "vitest";
import { assembleMaterialAssets } from "../../src/modules/assets/index.js";
import { assembleLearningTasks } from "../../src/modules/product-tasks/index.js";
import { assembleProductTaskResourceFacts } from "../../src/modules/product-tasks/adapters/content-access/product-task-resource-facts.js";
import { assembleContentAccess } from "../../src/modules/content-access/index.js";
import { assembleAccountRights } from "../../src/modules/account-rights/index.js";
import {
  assembleMaterials,
  assembleMaterialResourceFacts,
  ProductDirectory,
} from "../../src/modules/materials/index.js";
import type { ObjectStorage } from "../../src/infrastructure/object-storage/index.js";
import { createMigratedTestDatabase } from "./setup/test-database.js";
import { createQueryEventClient } from "./setup/query-events.js";

const id = (group: number, ordinal: number) =>
  `${String(group).padStart(7, "0") + "a"}-0000-4000-8000-${String(ordinal).padStart(12, "0")}`;
const sizes = [1, 20, 101] as const;
let corpora: Awaited<ReturnType<typeof corpus>>[];
const storage: ObjectStorage = {
  putImmutable: () => Promise.reject(new Error("Unexpected provider write")),
  read: () => Promise.reject(new Error("Unexpected provider read")),
  delete: () => Promise.reject(new Error("Unexpected provider delete")),
  signGet: () => Promise.reject(new Error("Unexpected provider signing")),
};
async function corpus(size: number) {
  const database = await createMigratedTestDatabase();
  const observer = createQueryEventClient(database.url);
  try {
    const now = new Date("2026-10-01T00:00:00.000Z");
    const productId = id(510, 1),
      chapterId = id(511, 1),
      taskId = id(512, 1),
      actor = id(513, 1);
    await database.prisma.product.create({
      data: { id: productId, name: "Asset programme", slug: "asset-programme" },
    });
    await database.prisma.productChapter.create({
      data: { id: chapterId, productId, name: "Assets", ordinal: 1 },
    });
    await database.prisma.material.createMany({
      data: Array.from({ length: size }, (_, index) => ({
        id: id(514, index + 1),
        title: `Asset group ${String(index + 1)}`,
        formatId: "note",
        access: "free",
        publicationState: "draft",
        contentVersion: 1n,
        createdBy: actor,
        schemaVersion: 1,
        body: { type: "doc", content: [] },
      })),
    });
    await database.prisma.materialAsset.createMany({
      data: Array.from({ length: size }, (_, index) => ({
        id: id(515, index + 1),
        materialId: id(514, index + 1),
        uploadedBy: actor,
        kind: "file",
        state: "ready",
        idempotencyKey: `asset-${String(index + 1)}`,
        requestFingerprint: "f".repeat(64),
        originalFilename: `file-${String(index + 1)}.pdf`,
        declaredContentType: "application/pdf",
        declaredSize: 100,
        expectedChecksum: "c".repeat(64),
        actualContentType: "application/pdf",
        actualSize: 100,
        actualChecksum: "c".repeat(64),
        objectNonce: id(516, index + 1),
        quarantineObjectKey: `quarantine-${String(index + 1)}`,
        protectedObjectKey: `protected-${String(index + 1)}`,
        readyAt: now,
        orphanedAt: now,
      })),
    });
    const firstAsset = await database.prisma.materialAsset.findUniqueOrThrow({
      where: { id: id(515, 1) },
    });
    await database.prisma.materialAsset.create({
      data: {
        ...firstAsset,
        id: id(515, 1000),
        idempotencyKey: "extra-file",
        objectNonce: id(516, 1000),
        originalFilename: "extra.pdf",
      },
    });
    const definition = {
      schemaVersion: 1,
      situation: "Present task resources",
      result: ["Read the task"],
      freedom: "Any stack",
      criteria: [
        {
          id: "resources",
          level: "required",
          requirement: "Use resources",
          acceptableEvidence: ["Files"],
        },
      ],
    };
    const page = {
      source: {
        title: "Resources",
        summary: "Files",
        markdown: "Files",
        links: {},
        images: {},
      },
      body: {
        schemaVersion: 1,
        doc: {
          type: "doc",
          content: Array.from({ length: size }, (_, index) => ({
            type: "assetFile",
            attrs: {
              nodeId: id(517, index + 1),
              assetId: id(515, index + 1),
              label: `File ${String(index + 1)}`,
            },
          })),
        },
      },
      resolvedLinks: {},
      resolvedImages: Object.fromEntries(
        Array.from({ length: size }, (_, index) => [
          `file-${String(index + 1)}`,
          { materialId: id(514, index + 1), assetId: id(515, index + 1) },
        ]),
      ),
    };
    await database.prisma.$transaction(async (transaction) => {
      await transaction.productTask.create({
        data: {
          id: taskId,
          code: "asset-task",
          sourceId: "fixture:asset-task",
          productId,
          chapterId,
          position: 1,
          title: "Asset Task",
          access: "free",
          relatedMaterialSourceIds: [],
          publicationState: "published",
          page,
          currentVersion: 1,
          revision: 1,
          createdAt: now,
          updatedAt: now,
        },
      });
      await transaction.productTaskVersion.create({
        data: {
          taskId,
          version: 1,
          definition,
          definitionDigest: "d".repeat(64),
          createdAt: now,
          sourceRepository: "fixture",
          sourceCommit: "c".repeat(40),
          sourcePath: "asset-task.md",
        },
      });
    });
    const materials = assembleMaterials({
      prisma: observer.prisma,
      authorPolicy: { canManage: () => false },
    });
    const assets = assembleMaterialAssets({
      prisma: observer.prisma,
      objectStorage: storage,
    });
    const contentAccess = assembleContentAccess({
      materialResourceFacts: assembleMaterialResourceFacts(
        materials.materialContent,
      ),
      productTaskResourceFacts: assembleProductTaskResourceFacts(
        observer.prisma,
      ),
      accountPermissions: { hasMaterialsManage: () => Promise.resolve(false) },
      accountRights: assembleAccountRights({ prisma: observer.prisma }),
      clock: () => now,
    });
    const tasks = assembleLearningTasks({
      prisma: observer.prisma,
      directory: new ProductDirectory(observer.prisma),
      contentAccess,
      materialAssets: assets,
      submissionsEnabled: false,
      clock: () => now,
    });
    return {
      tasks,
      assets,
      observer,
      async dispose() {
        await observer.prisma.$disconnect();
        await database.dispose();
      },
    };
  } catch (error) {
    await observer.prisma.$disconnect();
    await database.dispose();
    throw error;
  }
}
beforeAll(async () => {
  corpora = [];
  for (const size of sizes) corpora.push(await corpus(size));
});
afterAll(async () => {
  await Promise.all(corpora.map((entry) => entry.dispose()));
});
for (const [index, size] of sizes.entries()) {
  test(`Task presentation across ${String(size)} Materials uses bounded asset SQL and preserves file metadata`, async () => {
    const entry = corpora[index];
    if (entry === undefined) throw new Error("Missing corpus");
    const measured = await entry.observer.measure(() =>
      entry.tasks.page({
        subject: { kind: "anonymous" },
        productSlug: "asset-programme",
        code: "asset-task",
      }),
    );
    expect(measured.result.ok).toBe(true);
    if (!measured.result.ok) throw new Error(measured.result.error.code);
    expect(measured.result.value.access).toBe("open");
    const assetStatements = measured.statements.filter((statement) =>
      statement.includes('"assets"."material_'),
    );
    expect(assetStatements).toHaveLength(size <= 100 ? 2 : 4);
    expect(JSON.stringify(measured.result.value)).toContain(
      `file-${String(size)}.pdf`,
    );
  });
}

test("pair-set presentation does not combine one Material with another Material's asset ID", async () => {
  const entry = corpora[1];
  if (entry === undefined) throw new Error("Missing corpus");
  const measured = await entry.observer.measure(() =>
    entry.assets.loadPresentationsMany([
      { materialId: id(514, 1), assetId: id(515, 2) },
      { materialId: id(514, 2), assetId: id(515, 1) },
    ]),
  );
  expect(measured.result).toEqual({ ok: true, value: [] });
});

test("retains batching within one Material", async () => {
  const entry = corpora[1];
  if (entry === undefined) throw new Error("Missing corpus");
  const measured = await entry.observer.measure(() =>
    entry.assets.loadPresentationsMany([
      { materialId: id(514, 1), assetId: id(515, 1) },
      { materialId: id(514, 1), assetId: id(515, 1000) },
    ]),
  );
  expect(measured.statements).toHaveLength(2);
  expect(measured.result.ok).toBe(true);
  if (!measured.result.ok) throw new Error(measured.result.error.code);
  expect(measured.result.value).toHaveLength(2);
  expect(measured.result.value).toEqual(
    expect.arrayContaining([
      {
        assetId: id(515, 1),
        kind: "file",
        contentType: "application/pdf",
        size: 100,
        filename: "file-1.pdf",
      },
      {
        assetId: id(515, 1000),
        kind: "file",
        contentType: "application/pdf",
        size: 100,
        filename: "extra.pdf",
      },
    ]),
  );
});

test("canonical UUID aliases share one bounded pair set", async () => {
  const entry = corpora[2];
  if (entry === undefined) throw new Error("Missing corpus");
  const references = Array.from({ length: 101 }, (_, index) => ({
    materialId: id(514, index + 1),
    assetId: id(515, index + 1),
  }));
  const measured = await entry.observer.measure(() =>
    entry.assets.loadPresentationsMany([
      ...references,
      ...references.map((pair) => ({
        materialId: pair.materialId.toUpperCase(),
        assetId: pair.assetId.toUpperCase(),
      })),
    ]),
  );
  expect(measured.statements).toHaveLength(4);
  expect(measured.result.ok).toBe(true);
  if (!measured.result.ok) throw new Error(measured.result.error.code);
  expect(measured.result.value).toHaveLength(101);
});
