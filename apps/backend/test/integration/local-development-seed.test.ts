import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { seedLocalDevelopment } from "../../src/development/seed-local-development.js";
import { listPublishedMaterials } from "../../src/modules/content-library/index.js";
import { anonymousSubject } from "../../src/modules/content-access/index.js";
import {
  assembleMaterials,
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

  test("publishes a stable multi-page free and closed catalog when repeated", async () => {
    const first = await seedLocalDevelopment(testDatabase.prisma);
    const second = await seedLocalDevelopment(testDatabase.prisma);

    expect(second).toEqual(first);

    const { contentAccess, publishedMaterialReader } = assembleMaterials({
      prisma: testDatabase.prisma,
      authorPolicy: {
        canManage: () => false,
      },
    });
    const catalog = await listPublishedMaterials(
      publishedMaterialReader,
      contentAccess,
      { subject: anonymousSubject, first: 12 },
    );
    expect(catalog.ok).toBe(true);
    if (!catalog.ok) {
      throw new Error("Expected the local catalog seed to be readable");
    }
    expect(catalog.value.items).toHaveLength(12);
    expect(catalog.value.items.slice(0, 2)).toMatchObject([
      { slug: "developer-pipeline-bez-poteri-konteksta", access: "membership" },
      { slug: "kak-ustroen-inside-platform", access: "free" },
    ]);
    expect(typeof catalog.value.nextCursor).toBe("string");
    expect(await testDatabase.prisma.publishedMaterial.count()).toBe(13);

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
          contentVersion: first.contentVersion,
          title: "Как устроен Inside Platform",
        },
      },
    });
  });
});
