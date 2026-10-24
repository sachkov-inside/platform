import { registerFixedClock } from "../support/fixed-clock.js";

import { randomUUID } from "node:crypto";
import { platformMigrations } from "../../src/migrations/index.js";
import { afterAll, beforeAll, expect, test } from "vitest";
import { assembleMaterials } from "../../src/entrypoints/composition/assemble-materials.js";
import { readHomeContent } from "../../src/modules/content-library/features/read-home-content/read-home-content.js";
import { representativeDocument } from "../fixtures/material-body/representative.js";
import { emptyCatalogVideos } from "../support/catalog-videos.js";
import { migrateBefore, upgradeToLatest } from "./setup/historical-upgrade.js";
import {
  createTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

registerFixedClock();

const actor = randomUUID();
const topicId = randomUUID();
let database: TestDatabase;
let materials: ReturnType<typeof assembleMaterials>;
beforeAll(async () => {
  database = await createTestDatabase();
  // Upgrade the existing main ledger as an exact prefix; never reorder applied migrations.
  const pinStart = platformMigrations.findIndex(
    (migration) => migration.name === "0038_home_material_pin",
  );
  expect(platformMigrations[pinStart - 1]?.name).toBe("0045_notifications");
  await migrateBefore(database, "0038_home_material_pin");
  await upgradeToLatest(database);
  await database.prisma.topic.create({
    data: { id: topicId, name: "Home", slug: "home" },
  });
  materials = assembleMaterials({
    prisma: database.prisma,
    authorPolicy: { canManage: (id) => id === actor },
  });
});
afterAll(async () => {
  await database.dispose();
});

function metadata(title: string, productIds: string[]) {
  return {
    title,
    summary: "Public summary",
    access: "closed" as const,
    topicId,
    formatId: "guide",
    tagIds: [],
    difficulty: null,
    outcomes: [],
    productIds,
  };
}
async function createProduct(title: string) {
  const productId = randomUUID();
  await database.prisma.product.create({
    data: {
      id: productId,
      name: title,
      slug: `product-${productId}`,
      summary: "Product summary",
    },
  });
  return productId;
}
async function createMaterial(productId: string) {
  const input = {
    actor,
    idempotencyKey: randomUUID(),
    metadata: metadata("Material", [productId]),
    body: representativeDocument(
      "Private body never belongs in the Home projection.",
    ),
  };
  const created = await materials.authoring.createDraft(input);
  if (!created.ok) throw new Error(created.error.code);
  const saved = await materials.authoring.saveMaterial({
    ...input,
    idempotencyKey: randomUUID(),
    materialId: created.value.materialId,
    expectedContentVersion: 1,
    publicationState: "published",
  });
  if (!saved.ok) throw new Error(saved.error.code);
  return created.value.materialId;
}
async function change(
  materialId: string,
  productId: string,
  publicationState: "published" | "unpublished",
) {
  const current = await materials.authoring.loadMaterial({ actor, materialId });
  if (!current.ok) throw new Error(current.error.code);
  const result = await materials.authoring.saveMaterial({
    actor,
    materialId,
    idempotencyKey: randomUUID(),
    expectedContentVersion: current.value.contentVersion,
    metadata: metadata("Material", [productId]),
    publicationState,
    body: current.value.body,
  });
  if (!result.ok) throw new Error(result.error.code);
}
async function home() {
  const result = await readHomeContent(
    materials.publishedMaterialReader,
    materials.contentAccess,
    emptyCatalogVideos,
    { resolveForAccess: () => Promise.resolve({ kind: "required" }) },
    true,
    { kind: "anonymous" },
  );
  if (!result.ok) throw new Error(result.error.code);
  return result.value.pinnedProduct;
}

test("only Product can be pinned: author choice persists, competing writes conflict and visibility follows the published composition", async () => {
  const authoring = materials.authoring;
  const initial = await authoring.loadHomePin({ actor });
  if (!initial.ok) throw new Error(initial.error.code);
  const version = initial.value.version;
  expect(initial.value.productId).toBeNull();
  expect(await home()).toBeNull();
  const first = await createProduct("First product");
  const second = await createProduct("Second product");
  const empty = await createProduct("Empty product");
  const firstMaterial = await createMaterial(first);
  const secondMaterial = await createMaterial(second);
  expect(await authoring.loadHomePin({ actor: randomUUID() })).toEqual({
    ok: false,
    error: { code: "forbidden" },
  });
  expect(
    await authoring.setHomePin({
      actor: randomUUID(),
      productId: first,
      expectedVersion: version,
    }),
  ).toEqual({ ok: false, error: { code: "forbidden" } });
  for (const productId of [empty, firstMaterial, randomUUID()]) {
    expect(
      await authoring.setHomePin({
        actor,
        productId,
        expectedVersion: version,
      }),
    ).toMatchObject({ ok: false, error: { code: "invalid_reference" } });
  }
  const competing = await Promise.all(
    [first, second].map((productId) =>
      authoring.setHomePin({ actor, productId, expectedVersion: version }),
    ),
  );
  expect(competing.filter((result) => result.ok)).toHaveLength(1);
  expect(competing.filter((result) => !result.ok)).toEqual([
    { ok: false, error: { code: "stale_home_pin" } },
  ]);
  const restarted = assembleMaterials({
    prisma: database.prisma,
    authorPolicy: { canManage: () => true },
  });
  const saved = await restarted.authoring.loadHomePin({ actor });
  if (!saved.ok || saved.value.productId === null)
    throw new Error("Expected a saved pin");
  const pinnedId = saved.value.productId;
  const pinnedMaterial = pinnedId === first ? firstMaterial : secondMaterial;
  expect(saved.value.version).toBe(version + 1);
  expect(await home()).toMatchObject({
    id: pinnedId,
    summary: "Product summary",
    count: 1,
  });
  expect(JSON.stringify(await home())).not.toContain("Private body");
  expect(
    await authoring.setHomePin({
      actor,
      productId: null,
      expectedVersion: version,
    }),
  ).toEqual({ ok: false, error: { code: "stale_home_pin" } });
  await database.prisma.product.update({
    where: { id: pinnedId },
    data: { name: "Current product title", summary: "Current product summary" },
  });
  expect(await home()).toMatchObject({
    id: pinnedId,
    name: "Current product title",
    summary: "Current product summary",
  });
  await change(pinnedMaterial, pinnedId, "unpublished");
  expect(await home()).toBeNull();
  expect(await authoring.loadHomePin({ actor })).toEqual(saved);
  await change(pinnedMaterial, pinnedId, "published");
  expect(await home()).toMatchObject({ id: pinnedId });
  await database.prisma.product.update({
    where: { id: pinnedId },
    // deterministic-test-allow wall-clock: Date is fixed per case by registerFixedClock; production consumers share this virtual Date.
    data: { archivedAt: new Date() },
  });
  expect(await home()).toBeNull();
  expect(
    await authoring.setHomePin({
      actor,
      productId: pinnedId,
      expectedVersion: version + 1,
    }),
  ).toMatchObject({ ok: false, error: { code: "invalid_reference" } });
  expect(
    await authoring.setHomePin({
      actor,
      productId: null,
      expectedVersion: version + 1,
    }),
  ).toEqual({ ok: true, value: { productId: null, version: version + 2 } });
  expect(await home()).toBeNull();
  await expect(
    database.prisma.homeProductPin.create({ data: { id: 2 } }),
  ).rejects.toThrow();
  expect(await database.prisma.homeProductPin.count()).toBe(1);
});
