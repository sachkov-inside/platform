import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { assembleMaterials } from "../../src/modules/materials/index.js";
import { representativeDocument } from "../fixtures/material-body/representative.js";
import { createMigratedTestDatabase, type TestDatabase } from "./setup/test-database.js";

const actor = randomUUID();
const topicId = randomUUID();
let database: TestDatabase;
let materials: ReturnType<typeof assembleMaterials>;
beforeAll(async () => {
  database = await createMigratedTestDatabase();
  await database.prisma.topic.create({ data: { id: topicId, name: "Home", slug: "home" } });
  materials = assembleMaterials({ prisma: database.prisma, authorPolicy: { canManage: (id) => id === actor } });
});
afterAll(async () => { await database.dispose(); });

function metadata(title: string) { return { title, summary: "Public summary", access: "membership" as const, topicId, formatId: "guide", tagIds: [], seriesIds: [] }; }
async function create(title: string, publish = true) {
  const created = await materials.authoring.createDraft({ actor, idempotencyKey: randomUUID(), metadata: metadata(title), body: representativeDocument("Private body never belongs in the Home projection.") });
  if (!created.ok) throw new Error(created.error.code);
  if (publish) {
    const result = await materials.authoring.saveMaterial({ actor, idempotencyKey: randomUUID(), materialId: created.value.materialId, expectedContentVersion: 1, metadata: metadata(title), publicationState: "published", body: representativeDocument("Private body never belongs in the Home projection.") });
    if (!result.ok) throw new Error(result.error.code);
  }
  return created.value.materialId;
}
async function change(materialId: string, publicationState: "published" | "unpublished", title: string) {
  const current = await materials.authoring.loadMaterial({ actor, materialId });
  if (!current.ok) throw new Error(current.error.code);
  const result = await materials.authoring.saveMaterial({ actor, materialId, idempotencyKey: randomUUID(), expectedContentVersion: current.value.contentVersion, metadata: metadata(title), publicationState, body: current.value.body });
  if (!result.ok) throw new Error(result.error.code);
}

test("author selection persists, stays unique under competing writes, and only projects current published metadata", async () => {
  const authoring = materials.authoring;
  const reader = materials.publishedMaterialReader;
  expect(await authoring.loadHomePin({ actor })).toEqual({ ok: true, value: { materialId: null, version: 1 } });
  expect(await reader.readHomePinnedProjection()).toEqual({ ok: true, value: null });
  const first = await create("First pinned material");
  const second = await create("Second pinned material");
  const draft = await create("Hidden draft", false);
  expect(await authoring.loadHomePin({ actor: randomUUID() })).toEqual({ ok: false, error: { code: "forbidden" } });
  expect(await authoring.setHomePin({ actor: randomUUID(), materialId: first, expectedVersion: 1 })).toEqual({ ok: false, error: { code: "forbidden" } });
  expect(await authoring.setHomePin({ actor, materialId: draft, expectedVersion: 1 })).toMatchObject({ ok: false, error: { code: "invalid_reference" } });
  expect(await authoring.setHomePin({ actor, materialId: randomUUID(), expectedVersion: 1 })).toEqual({ ok: false, error: { code: "material_not_found" } });

  const competing = await Promise.all([first, second].map((materialId) => authoring.setHomePin({ actor, materialId, expectedVersion: 1 })));
  expect(competing.filter((result) => result.ok)).toHaveLength(1);
  expect(competing.filter((result) => !result.ok)).toEqual([{ ok: false, error: { code: "stale_home_pin" } }]);
  const restarted = assembleMaterials({ prisma: database.prisma, authorPolicy: { canManage: () => true } });
  const saved = await restarted.authoring.loadHomePin({ actor });
  if (!saved.ok || saved.value.materialId === null) throw new Error("Expected a saved pin");
  const pinnedId = saved.value.materialId;
  expect(saved.value.version).toBe(2);
  expect(await reader.readHomePinnedProjection()).toMatchObject({ ok: true, value: { materialId: pinnedId, summary: "Public summary", access: "membership" } });
  expect(JSON.stringify(await reader.readHomePinnedProjection())).not.toContain("Private body");
  expect(await authoring.setHomePin({ actor, materialId: null, expectedVersion: 1 })).toEqual({ ok: false, error: { code: "stale_home_pin" } });

  await change(pinnedId, "published", "Current title");
  expect(await reader.readHomePinnedProjection()).toMatchObject({ ok: true, value: { materialId: pinnedId, title: "Current title" } });
  await change(pinnedId, "unpublished", "Hidden title");
  expect(await reader.readHomePinnedProjection()).toEqual({ ok: true, value: null });
  expect(await authoring.loadHomePin({ actor })).toEqual(saved);
  expect(await authoring.setHomePin({ actor, materialId: pinnedId, expectedVersion: 2 })).toMatchObject({ ok: false, error: { code: "invalid_reference" } });
  await change(pinnedId, "published", "Republished title");
  expect(await reader.readHomePinnedProjection()).toMatchObject({ ok: true, value: { materialId: pinnedId, title: "Republished title" } });
  expect(await authoring.setHomePin({ actor, materialId: null, expectedVersion: 2 })).toEqual({ ok: true, value: { materialId: null, version: 3 } });
  expect(await reader.readHomePinnedProjection()).toEqual({ ok: true, value: null });
  await expect(database.prisma.homeMaterialPin.create({ data: { id: 2 } })).rejects.toThrow();
  expect(await database.prisma.homeMaterialPin.count()).toBe(1);
});
