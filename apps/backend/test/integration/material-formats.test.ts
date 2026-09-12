import { Prisma } from "../../src/infrastructure/prisma/index.js";
import { runMigrationsToLatest } from "../../src/infrastructure/postgres/migrate-to-latest.js";
import { migrateToLatest, platformMigrations } from "../../src/migrations/index.js";
import { afterAll, beforeAll, expect, test } from "vitest";

import { assembleMaterials } from "../../src/modules/materials/index.js";
import { representativeDocument } from "../fixtures/material-body/representative.js";
import { createMigratedTestDatabase, createTestDatabase, type TestDatabase } from "./setup/test-database.js";

const actor = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
let database: TestDatabase;
beforeAll(async () => { database = await createMigratedTestDatabase(); });
afterAll(async () => { await database.dispose(); });

test("a clean production database offers and saves the three domain formats without a development seed", async () => {
  const { authoring } = assembleMaterials({ prisma: database.prisma, authorPolicy: { canManage: () => true } });
  const references = await authoring.listReferences({ actor });
  expect(references).toMatchObject({ ok: true, value: { formats: [
    { name: "Видео", archived: false }, { name: "Гайд", archived: false }, { name: "Заметка", archived: false },
  ] } });
  if (!references.ok) throw new Error(references.error.code);
  for (const format of references.value.formats) {
    const created = await authoring.createDraft({
      actor, idempotencyKey: `domain-format-${format.id}`,
      metadata: { title: format.name, summary: null, access: "free", topicId: null, formatId: format.id, tagIds: [], difficulty: null, outcomes: [], seriesIds: [] },
      body: representativeDocument("Содержимое материала"),
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(created.error.code);
    expect(await authoring.saveMaterial({
      actor, materialId: created.value.materialId, idempotencyKey: `save-format-${format.id}`,
      expectedContentVersion: created.value.contentVersion, publicationState: "draft",
      metadata: { title: format.name, summary: null, access: "free", topicId: null, formatId: format.id, tagIds: [], difficulty: null, outcomes: [], seriesIds: [] },
      body: representativeDocument("Сохранённое содержимое"),
    })).toMatchObject({ ok: true });
    expect(await authoring.loadMaterial({ actor, materialId: created.value.materialId })).toMatchObject({
      ok: true, value: { metadata: { formatId: format.id, title: format.name } },
    });
  }
});

test.each(["podcast", "38900000-0000-4000-8000-000000000001"])("rejects unsupported format %s", async (formatId) => {
  const { authoring } = assembleMaterials({ prisma: database.prisma, authorPolicy: { canManage: () => true } });
  expect(await authoring.createDraft({
    actor, idempotencyKey: `unsupported-${formatId}`,
    metadata: { title: "Unsupported", summary: null, access: "free", topicId: null, formatId, tagIds: [], difficulty: null, outcomes: [], seriesIds: [] },
    body: representativeDocument("Body"),
  })).toMatchObject({ ok: false, error: { code: "invalid_content", issues: [{ code: "invalid_metadata", path: "/metadata/formatId" }] } });
});

test.each(["video", "guide", "note", "text"])("migrates legacy %s references without changing Material content", async (legacySlug) => {
  const legacy = await createTestDatabase();
  try {
    const migrationIndex = platformMigrations.findIndex(({ name }) => name === "0035_domain_material_formats");
    expect(migrationIndex).toBeGreaterThan(0);
    await runMigrationsToLatest(legacy.url, platformMigrations.slice(0, migrationIndex));
    const formatId = "38900000-0000-4000-8000-000000000001";
    const materialId = "38900000-0000-4000-8000-000000000002";
    await legacy.prisma.$executeRaw(Prisma.sql`insert into materials.formats (id, slug, name) values (${formatId}::uuid, ${legacySlug}, 'Legacy format')`);
    await insertLegacyMaterial(legacy, materialId, formatId);
    await migrateToLatest(legacy.url);
    expect(await legacy.prisma.material.findUnique({ where: { id: materialId } })).toMatchObject({
      formatId: legacySlug === "text" ? "note" : legacySlug,
      body: { type: "doc", content: [] }, contentVersion: 1n,
    });
    expect(await legacy.prisma.$queryRaw(Prisma.sql`select to_regclass('materials.formats')::text as relation`)).toEqual([{ relation: null }]);
  } finally { await legacy.dispose(); }
});

test("refuses unknown referenced legacy formats and preserves the database for explicit conversion", async () => {
  const legacy = await createTestDatabase();
  try {
    const migrationIndex = platformMigrations.findIndex(({ name }) => name === "0035_domain_material_formats");
    expect(migrationIndex).toBeGreaterThan(0);
    await runMigrationsToLatest(legacy.url, platformMigrations.slice(0, migrationIndex));
    const formatId = "38900000-0000-4000-8000-000000000003";
    const materialId = "38900000-0000-4000-8000-000000000004";
    await legacy.prisma.$executeRaw(Prisma.sql`insert into materials.formats (id, slug, name) values (${formatId}::uuid, 'podcast', 'Podcast')`);
    await insertLegacyMaterial(legacy, materialId, formatId);
    await expect(migrateToLatest(legacy.url)).rejects.toThrow("Unsupported legacy material format");
    // Схема осталась дореформенной, поэтому строка читается её же колонками.
    expect(await legacy.prisma.$queryRaw(Prisma.sql`select format_id::text as "formatId" from materials.materials where id = ${materialId}::uuid`)).toEqual([{ formatId }]);
    expect(await legacy.prisma.$queryRaw(Prisma.sql`select slug from materials.formats`)).toEqual([{ slug: "podcast" }]);
  } finally { await legacy.dispose(); }
});

/**
 * Строка пишется прямо в SQL той схемы, которая тогда существовала. Через Prisma сюда приезжают
 * все нынешние колонки Material сразу, поэтому любая новая колонка ломала бы проверку миграции,
 * к которой она не относится.
 */
async function insertLegacyMaterial(
  legacy: TestDatabase,
  materialId: string,
  formatId: string,
): Promise<void> {
  await legacy.prisma.$executeRaw(Prisma.sql`
    insert into materials.materials
      (id, format_id, schema_version, body, created_by, access, publication_state, content_version)
    values (
      ${materialId}::uuid, ${formatId}::uuid, 1, ${'{"type":"doc","content":[]}'}::jsonb,
      ${actor}::uuid, 'free', 'draft', 1
    )
  `);
}
