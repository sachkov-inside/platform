import { afterAll, beforeAll, expect, test } from "vitest";
import { assembleMaterials } from "../../src/modules/materials/index.js";
import { listPublishedMaterials } from "../../src/modules/content-library/index.js";
import { publishedCatalogPageHttpSchema } from "../../src/modules/content-library/shared/published-catalog-http.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

let database: TestDatabase;
const ids = [1, 2, 3].map(
  (ordinal) => `42000000-0000-4000-8000-${String(ordinal).padStart(12, "0")}`,
);
const firstTitle = "界".repeat(159) + "一";
beforeAll(async () => {
  database = await createMigratedTestDatabase();
  const topicId = "44000000-0000-4000-8000-000000000001";
  await database.prisma.topic.create({
    data: { id: topicId, name: "Cursor topic", slug: "cursor-topic" },
  });
  const publishedAt = new Date("2026-10-01T00:00:00.000Z");
  for (const [index, id] of ids.entries()) {
    const title = index === 2 ? "界".repeat(159) + "二" : firstTitle;
    const facts = {
      slug: `catalog-cursor-${String(index)}`,
      title,
      summary: "Cursor fixture",
      access: "free",
      topicId,
      formatId: "note",
      contentVersion: 1n,
      publishedAt,
      publishedBy: "43000000-0000-4000-8000-000000000001",
    };
    await database.prisma.material.create({
      data: {
        ...facts,
        id,
        createdBy: facts.publishedBy,
        schemaVersion: 1,
        body: { type: "doc", content: [] },
        publicationState: "published",
        firstPublishedAt: publishedAt,
      },
    });
    await database.prisma.publishedMaterial.create({
      data: { ...facts, materialId: id, publicSearchText: "Cursor fixture" },
    });
  }
});
afterAll(async () => {
  await database.dispose();
});

test("maximum multilingual titles and equal sort keys traverse once through the public catalog", async () => {
  const materials = assembleMaterials({
    prisma: database.prisma,
    authorPolicy: { canManage: () => false },
  });
  const videos = {
    loadReadyDurations: () => Promise.resolve({ ok: true as const, value: [] }),
  };
  const seen: string[] = [];
  let after: string | undefined;
  for (;;) {
    const result = await listPublishedMaterials(
      materials.publishedMaterialReader,
      materials.contentAccess,
      videos,
      {
        first: 1,
        subject: { kind: "anonymous" },
        sort: "title",
        ...(after === undefined ? {} : { after }),
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.code);
    expect(publishedCatalogPageHttpSchema.safeParse(result.value).success).toBe(
      true,
    );
    seen.push(...result.value.items.map((item) => item.materialId));
    if (result.value.nextCursor === null) break;
    expect(result.value.nextCursor.length).toBeGreaterThan(512);
    after = result.value.nextCursor;
  }
  expect(seen).toEqual(ids);
});
