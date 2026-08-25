import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { seedLocalDevelopment } from "../../src/development/seed-local-development.js";
import { createListPublishedMaterialsOperation } from "../../src/modules/content-library/index.js";
import {
  anonymousSubject,
  createMaterials,
} from "../../src/modules/materials/index.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

describe("local development seed", () => {
  let testDatabase: TestDatabase;

  beforeAll(async () => {
    testDatabase = await createMigratedTestDatabase();
  });

  afterAll(async () => {
    await testDatabase.dispose();
  });

  test("publishes a stable free and closed catalog when repeated", async () => {
    const first = await seedLocalDevelopment(testDatabase.database);
    const second = await seedLocalDevelopment(testDatabase.database);

    expect(second).toEqual(first);

    const { publishedMaterialReader } = createMaterials({
      database: testDatabase.database,
      authorPolicy: {
        canAuthor: () => false,
        canPublish: () => false,
      },
    });
    const listPublishedMaterials = createListPublishedMaterialsOperation({
      publishedMaterialReader,
    });
    const catalog = await listPublishedMaterials({ first: 12 });
    expect(catalog).toMatchObject({
      ok: true,
      value: {
        items: [
          { slug: "membership-delivery-guide", access: "membership" },
          { slug: "inside-platform-overview", access: "free" },
        ],
        nextCursor: null,
      },
    });

    await expect(
      publishedMaterialReader.read({
        subject: anonymousSubject,
        slug: first.slug,
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        kind: "available",
        projection: {
          materialId: first.materialId,
          revisionId: first.revisionId,
          title: "Как устроен Inside Platform",
        },
      },
    });
  });
});
