import { afterAll, beforeAll, expect, test } from "vitest";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";
import { seedReadingScenario } from "../support/seed-reading-scenario.js";
import { listPublishedMaterials } from "../../src/modules/content-library/index.js";
import { anonymousSubject } from "../../src/modules/content-access/index.js";
import { emptyCatalogVideos } from "../support/catalog-videos.js";

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
    expect(result.value.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: "Материал 18", access: "closed" }),
      ]),
    );
  });
});
