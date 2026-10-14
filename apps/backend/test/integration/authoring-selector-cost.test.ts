import { afterAll, beforeAll, expect, test } from "vitest";
import { assembleMaterials } from "../../src/modules/materials/index.js";
import { createMigratedTestDatabase } from "./setup/test-database.js";
import { createQueryEventClient } from "./setup/query-events.js";

const sizes = [1, 100, 1000] as const;
const actor = "00000520-0000-4000-8000-000000000001";
const id = (group: number, ordinal: number) =>
  `${String(group).padStart(8, "0")}-0000-4000-8000-${String(ordinal).padStart(12, "0")}`;
let corpora: Awaited<ReturnType<typeof corpus>>[];
async function corpus(size: number) {
  const database = await createMigratedTestDatabase();
  const observer = createQueryEventClient(database.url);
  try {
    const now = new Date("2026-10-01T00:00:00.000Z");
    const rows = (group: number, label: string) =>
      Array.from({ length: size }, (_, index) => ({
        id: id(group, index + 1),
        name: `${label} ${String(index + 1).padStart(4, "0")}`,
        slug: `selector-${String(group)}-${String(index + 1)}`,
        createdAt: now,
        updatedAt: now,
      }));
    await database.prisma.product.createMany({
      data: rows(521, "Руководство"),
    });
    await database.prisma.topic.createMany({ data: rows(522, "Тема") });
    await database.prisma.tag.createMany({
      data: Array.from({ length: size }, (_, index) => {
        const name = `Метка ${String(index + 1).padStart(4, "0")}`;
        return {
          id: id(523, index + 1),
          name,
          normalizedName: name.toLowerCase(),
        };
      }),
    });
    const authoring = assembleMaterials({
      prisma: observer.prisma,
      authorPolicy: { canManage: (id) => id === actor },
    }).authoring;
    return {
      authoring,
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
  test(`measures complete authoring selectors at ${String(size)} rows per collection kind`, async () => {
    const entry = corpora[index];
    if (entry === undefined) throw new Error("Missing corpus");
    const references = await entry.observer.measure(() =>
      entry.authoring.listReferences({ actor }),
    );
    const products = await entry.observer.measure(() =>
      entry.authoring.listContentCollections({ actor, kind: "product" }),
    );
    const topics = await entry.observer.measure(() =>
      entry.authoring.listContentCollections({ actor, kind: "topic" }),
    );
    if (!references.result.ok || !products.result.ok || !topics.result.ok)
      throw new Error("Selector read failed");
    expect(references.result.value.series).toHaveLength(size);
    expect(references.result.value.topics).toHaveLength(size);
    expect(references.result.value.tags).toHaveLength(size);
    expect(products.result.value).toHaveLength(size);
    expect(topics.result.value).toHaveLength(size);
    expect(references.statements).toHaveLength(3);
    expect(products.statements).toHaveLength(2);
    expect(topics.statements).toHaveLength(2);
    process.stdout.write(
      `${JSON.stringify({ record: "PC-4", fixture: size, source: "catalog worker owning Materials selectors", references: { rows: 3 * size + references.result.value.formats.length, statements: references.statements.length, bytes: Buffer.byteLength(JSON.stringify(references.result.value), "utf8") }, products: { rows: products.result.value.length, statements: products.statements.length, bytes: Buffer.byteLength(JSON.stringify(products.result.value), "utf8") }, topics: { rows: topics.result.value.length, statements: topics.statements.length, bytes: Buffer.byteLength(JSON.stringify(topics.result.value), "utf8") }, ownerCalls: 3, providerRequests: 0 })}\n`,
    );
  });
}
