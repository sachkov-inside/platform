import { afterAll, beforeAll, expect, test } from "vitest";
import { PublicContentTargets } from "../../src/modules/materials/index.js";
import { validateTargets } from "../../src/modules/communications/features/validate-targets/validate-targets.js";
import { createMigratedTestDatabase } from "./setup/test-database.js";
import { createQueryEventClient } from "./setup/query-events.js";

const sizes = [1, 20, 100] as const;
const id = (group: number, ordinal: number) =>
  `${String(group).padStart(8, "0")}-0000-4000-8000-${String(ordinal).padStart(12, "0")}`;
let corpora: Awaited<ReturnType<typeof corpus>>[];
async function corpus(size: number) {
  const database = await createMigratedTestDatabase();
  const observer = createQueryEventClient(database.url);
  try {
    const topicId = id(500, 1);
    await database.prisma.topic.create({
      data: { id: topicId, name: "Targets", slug: "targets" },
    });
    await database.prisma.product.createMany({
      data: Array.from({ length: size }, (_, index) => ({
        id: id(501, index + 1),
        name: `Product ${String(index + 1)}`,
        slug: `product-${String(index + 1)}`,
        archivedAt: index === 0 ? new Date("2026-10-01T00:00:00.000Z") : null,
      })),
    });
    await database.prisma.material.createMany({
      data: Array.from({ length: size }, (_, index) => ({
        id: id(502, index + 1),
        topicId,
        title: `Material ${String(index + 1)}`,
        slug: `material-${String(index + 1)}`,
        summary: "Targets",
        formatId: "note",
        access: index === 0 ? "closed" : "free",
        contentVersion: 1n,
        publicationState: "published",
        publishedAt: new Date("2026-10-01T00:00:00.000Z"),
        firstPublishedAt: new Date("2026-10-01T00:00:00.000Z"),
        publishedBy: id(503, 1),
        createdBy: id(503, 1),
        schemaVersion: 1,
        body: { type: "doc", content: [] },
      })),
    });
    const targets = new PublicContentTargets(observer.prisma);
    const urls = Array.from({ length: size }, (_, index) => [
      `https://inside.example/materials/material-${String(index + 1)}`,
      `https://inside.example/products/product-${String(index + 1)}`,
      `https://inside.example/guides/product-${String(index + 1)}`,
    ]).flat();
    return {
      size,
      targets,
      observer,
      parts: [
        {
          partId: id(504, 1),
          content: {
            type: "text" as const,
            text: urls.join("\n"),
            entities: [],
            buttons: [],
          },
        },
      ],
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
  test(`validates ${String(size)} Material/Product slug sets with bounded physical SQL and original URL association`, async () => {
    const entry = corpora[index];
    if (entry === undefined) throw new Error("Missing corpus");
    const measured = await entry.observer.measure(() =>
      validateTargets(entry.parts, "https://inside.example", entry.targets),
    );
    expect(measured.statements).toHaveLength(2);
    expect(measured.result).toEqual([
      {
        url: "https://inside.example/materials/material-1",
        reason: "not_free",
        targetId: id(502, 1),
      },
      {
        url: "https://inside.example/products/product-1",
        reason: "not_published",
        targetId: id(501, 1),
      },
      {
        url: "https://inside.example/guides/product-1",
        reason: "not_published",
        targetId: id(501, 1),
      },
    ]);
  });
}
