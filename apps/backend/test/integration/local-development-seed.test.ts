import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { seedLocalDevelopment } from "../../src/development/seed-local-development.js";
import { anonymousSubject, createMaterials } from "../../src/modules/materials/index.js";
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

  test("publishes one stable representative Material when repeated", async () => {
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
