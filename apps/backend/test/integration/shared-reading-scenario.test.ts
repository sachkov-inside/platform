import { registerFixedClock } from "../support/fixed-clock.js";
import { afterAll, beforeAll, expect, test } from "vitest";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";
import { seedReadingScenario } from "../support/seed-reading-scenario.js";
import { listPublishedMaterials } from "../../src/modules/content-library/index.js";
import { anonymousSubject } from "../../src/modules/content-access/index.js";
import { emptyCatalogVideos } from "../support/catalog-videos.js";

registerFixedClock();

let database: TestDatabase;
beforeAll(async () => {
  database = await createMigratedTestDatabase();
});
afterAll(async () => {
  await database.dispose();
});

test("isolated shared reading facts publish a paginated catalogue through domain interfaces", async () => {
  await database.run(async () => {
    const { materials } = await seedReadingScenario(database);
    const result = await listPublishedMaterials(
      materials.publishedMaterialReader,
      materials.contentAccess,
      emptyCatalogVideos,
      { subject: anonymousSubject, first: 12 },
    );
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error("Expected published catalogue");
    expect(result.value.items).toHaveLength(12);
    expect(result.value.nextCursor).toEqual(expect.any(String));
    if (result.value.nextCursor === null)
      throw new Error("Expected continuation cursor");
    const next = await listPublishedMaterials(
      materials.publishedMaterialReader,
      materials.contentAccess,
      emptyCatalogVideos,
      {
        subject: anonymousSubject,
        first: 12,
        after: result.value.nextCursor,
      },
    );
    if (!next.ok) throw new Error("Expected next catalogue page");
    expect(next.value.items).toHaveLength(6);
    expect(next.value.nextCursor).toBeNull();
    const items = [...result.value.items, ...next.value.items];
    expect(new Set(items.map(({ materialId }) => materialId)).size).toBe(18);
    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: "Материал 18", access: "closed" }),
        expect.objectContaining({ title: "Материал 1", access: "free" }),
      ]),
    );
  });
});

test("refuses a non-isolated database before creating any domain data", async () => {
  const url = new URL(database.url);
  url.pathname = "/inside";
  await expect(
    seedReadingScenario({ prisma: database.prisma, url: url.toString() }),
  ).rejects.toThrow("requires an isolated test database");
});

test("refuses a forged isolated name that does not match its live connection", async () => {
  const url = new URL(database.url);
  url.pathname = `/inside_test_${"0".repeat(32)}`;
  await expect(
    seedReadingScenario({ prisma: database.prisma, url: url.toString() }),
  ).rejects.toThrow("database ownership mismatch");
});
