import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { seedLocalDevelopment } from "../../src/development/seed-local-development.js";
import { createContentLibrary } from "../../src/modules/content-library/index.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

describe("ContentLibrary", () => {
  let testDatabase: TestDatabase;

  beforeAll(async () => {
    testDatabase = await createMigratedTestDatabase();
    await seedLocalDevelopment(testDatabase.database);
  });

  afterAll(async () => {
    await testDatabase.dispose();
  });

  test("continues through deterministic pages of safe published projections", async () => {
    const contentLibrary = createContentLibrary({ database: testDatabase.database });

    const firstPage = await contentLibrary.listPublishedMaterials({ first: 1 });
    expect(firstPage).toMatchObject({
      ok: true,
      value: {
        items: [
          {
            slug: "membership-delivery-guide",
            title: "Developer Pipeline без потери контекста",
            access: "membership",
          },
        ],
      },
    });
    expect(firstPage.ok && typeof firstPage.value.nextCursor === "string").toBe(true);
    if (!firstPage.ok || firstPage.value.nextCursor === null) {
      throw new Error("Expected the first catalog page to continue");
    }

    const secondPage = await contentLibrary.listPublishedMaterials({
      after: firstPage.value.nextCursor,
      first: 1,
    });
    expect(secondPage).toEqual({
      ok: true,
      value: {
        items: [
          expect.objectContaining({
            slug: "inside-platform-overview",
            title: "Как устроен Inside Platform",
            access: "free",
          }),
        ],
        nextCursor: null,
      },
    });
    expect(JSON.stringify([firstPage, secondPage])).not.toContain("schemaVersion");
    expect(JSON.stringify([firstPage, secondPage])).not.toContain("blocks");
  });
});
