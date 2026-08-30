import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { seedLocalDevelopment } from "../../src/development/seed-local-development.js";
import { listPublishedMaterials } from "../../src/modules/content-library/index.js";
import { anonymousSubject } from "../../src/modules/content-access/index.js";
import { assembleMaterials } from "../../src/modules/materials/index.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

describe("ListPublishedMaterials", () => {
  let testDatabase: TestDatabase;

  beforeAll(async () => {
    testDatabase = await createMigratedTestDatabase();
    await seedLocalDevelopment(testDatabase.prisma);
  });

  afterAll(async () => {
    await testDatabase.dispose();
  });

  test("continues through deterministic pages of safe published projections", async () => {
    const { contentAccess, publishedMaterialReader } = assembleMaterials({
      prisma: testDatabase.prisma,
      authorPolicy: { canManage: () => false },
    });
    const firstPage = await listPublishedMaterials(
      publishedMaterialReader,
      contentAccess,
      { subject: anonymousSubject, first: 1 },
    );
    expect(firstPage).toMatchObject({
      ok: true,
      value: {
        items: [
          {
            slug: "developer-pipeline-bez-poteri-konteksta",
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

    const secondPage = await listPublishedMaterials(
      publishedMaterialReader,
      contentAccess,
      {
        subject: anonymousSubject,
        after: firstPage.value.nextCursor,
        first: 1,
      },
    );
    expect(secondPage).toMatchObject({
      ok: true,
      value: {
        items: [
          expect.objectContaining({
            slug: "kak-ustroen-inside-platform",
            title: "Как устроен Inside Platform",
            access: "free",
          }),
        ],
      },
    });
    expect(
      secondPage.ok && typeof secondPage.value.nextCursor === "string",
    ).toBe(true);
    expect(JSON.stringify([firstPage, secondPage])).not.toContain("schemaVersion");
    expect(JSON.stringify([firstPage, secondPage])).not.toContain("blocks");
  });
});
