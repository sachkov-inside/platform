import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { assembleMaterials } from "../../src/modules/materials/index.js";
import { readHomeContent } from "../../src/modules/content-library/features/read-home-content/read-home-content.js";
import { representativeDocument } from "../fixtures/material-body/representative.js";
import { emptyCatalogVideos } from "../support/catalog-videos.js";
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

function metadata(title: string, seriesIds: string[]) { return { title, summary: "Public summary", access: "membership" as const, topicId, formatId: "guide", tagIds: [], seriesIds }; }
async function createSeries(title: string) {
  const seriesId = randomUUID();
  await database.prisma.series.create({ data: { id: seriesId, name: title, slug: `series-${seriesId}`, summary: "Series summary" } });
  return seriesId;
}
async function createMaterial(seriesId: string) {
  const input = { actor, idempotencyKey: randomUUID(), metadata: metadata("Material", [seriesId]), body: representativeDocument("Private body never belongs in the Home projection.") };
  const created = await materials.authoring.createDraft(input);
  if (!created.ok) throw new Error(created.error.code);
  const saved = await materials.authoring.saveMaterial({ ...input, idempotencyKey: randomUUID(), materialId: created.value.materialId, expectedContentVersion: 1, publicationState: "published" });
  if (!saved.ok) throw new Error(saved.error.code);
  return created.value.materialId;
}
async function change(materialId: string, seriesId: string, publicationState: "published" | "unpublished") {
  const current = await materials.authoring.loadMaterial({ actor, materialId });
  if (!current.ok) throw new Error(current.error.code);
  const result = await materials.authoring.saveMaterial({ actor, materialId, idempotencyKey: randomUUID(), expectedContentVersion: current.value.contentVersion, metadata: metadata("Material", [seriesId]), publicationState, body: current.value.body });
  if (!result.ok) throw new Error(result.error.code);
}
async function home() {
  const result = await readHomeContent(materials.publishedMaterialReader, materials.contentAccess, emptyCatalogVideos, { resolveForAccess: () => Promise.resolve({ kind: "required" }) }, "https://inside.example.test/join", { kind: "anonymous" });
  if (!result.ok) throw new Error(result.error.code);
  return result.value.pinnedSeries;
}

test("only Series can be pinned: author choice persists, competing writes conflict and visibility follows the published composition", async () => {
  const authoring = materials.authoring;
  const initial = await authoring.loadHomePin({ actor });
  if (!initial.ok) throw new Error(initial.error.code);
  const version = initial.value.version;
  expect(initial.value.seriesId).toBeNull();
  expect(await home()).toBeNull();
  const first = await createSeries("First series");
  const second = await createSeries("Second series");
  const empty = await createSeries("Empty series");
  const firstMaterial = await createMaterial(first);
  const secondMaterial = await createMaterial(second);
  expect(await authoring.loadHomePin({ actor: randomUUID() })).toEqual({ ok: false, error: { code: "forbidden" } });
  expect(await authoring.setHomePin({ actor: randomUUID(), seriesId: first, expectedVersion: version })).toEqual({ ok: false, error: { code: "forbidden" } });
  for (const seriesId of [empty, firstMaterial, randomUUID()]) {
    expect(await authoring.setHomePin({ actor, seriesId, expectedVersion: version })).toMatchObject({ ok: false, error: { code: "invalid_reference" } });
  }
  const competing = await Promise.all([first, second].map((seriesId) => authoring.setHomePin({ actor, seriesId, expectedVersion: version })));
  expect(competing.filter((result) => result.ok)).toHaveLength(1);
  expect(competing.filter((result) => !result.ok)).toEqual([{ ok: false, error: { code: "stale_home_pin" } }]);
  const restarted = assembleMaterials({ prisma: database.prisma, authorPolicy: { canManage: () => true } });
  const saved = await restarted.authoring.loadHomePin({ actor });
  if (!saved.ok || saved.value.seriesId === null) throw new Error("Expected a saved pin");
  const pinnedId = saved.value.seriesId;
  const pinnedMaterial = pinnedId === first ? firstMaterial : secondMaterial;
  expect(saved.value.version).toBe(version + 1);
  expect(await home()).toMatchObject({ id: pinnedId, summary: "Series summary", count: 1 });
  expect(JSON.stringify(await home())).not.toContain("Private body");
  expect(await authoring.setHomePin({ actor, seriesId: null, expectedVersion: version })).toEqual({ ok: false, error: { code: "stale_home_pin" } });
  await database.prisma.series.update({ where: { id: pinnedId }, data: { name: "Current series title", summary: "Current series summary" } });
  expect(await home()).toMatchObject({ id: pinnedId, name: "Current series title", summary: "Current series summary" });
  await change(pinnedMaterial, pinnedId, "unpublished");
  expect(await home()).toBeNull();
  expect(await authoring.loadHomePin({ actor })).toEqual(saved);
  await change(pinnedMaterial, pinnedId, "published");
  expect(await home()).toMatchObject({ id: pinnedId });
  await database.prisma.series.update({ where: { id: pinnedId }, data: { archivedAt: new Date() } });
  expect(await home()).toBeNull();
  expect(await authoring.setHomePin({ actor, seriesId: pinnedId, expectedVersion: version + 1 })).toMatchObject({ ok: false, error: { code: "invalid_reference" } });
  expect(await authoring.setHomePin({ actor, seriesId: null, expectedVersion: version + 1 })).toEqual({ ok: true, value: { seriesId: null, version: version + 2 } });
  expect(await home()).toBeNull();
  await expect(database.prisma.homeSeriesPin.create({ data: { id: 2 } })).rejects.toThrow();
  expect(await database.prisma.homeSeriesPin.count()).toBe(1);
});
