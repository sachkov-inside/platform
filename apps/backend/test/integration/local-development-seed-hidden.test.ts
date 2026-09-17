import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { seedLocalDevelopment } from "../../src/development/seed-local-development.js";
import { createMigratedTestDatabase, type TestDatabase } from "./setup/test-database.js";

// Budgets follow local-development-seed.test.ts: two full seed runs on a fresh database.
const migratedDatabaseBudgetMs = 10_000;
const twoSeedRunsBudgetMs = 30_000;

describe("local development seed for the owner's stand", () => {
  let database: TestDatabase;
  beforeAll(async () => { database = await createMigratedTestDatabase(); }, migratedDatabaseBudgetMs);
  afterAll(async () => { await database.dispose(); });

  test("keeps demo Materials for the editor, off the reader and unpublished across runs", async () => {
    await seedLocalDevelopment(database.prisma, { demo: "hidden" });
    const seeded = await database.prisma.material.findMany({ select: { id: true, publicationState: true, contentVersion: true } });
    expect(seeded.length).toBeGreaterThan(0);
    expect(seeded.filter((material) => material.publicationState === "published")).toEqual([]);
    expect(await database.prisma.publishedMaterial.count()).toBe(0);

    await seedLocalDevelopment(database.prisma, { demo: "hidden" });
    const repeated = await database.prisma.material.findMany({ select: { id: true, publicationState: true, contentVersion: true } });
    expect(repeated).toEqual(expect.arrayContaining(seeded));
    expect(repeated).toHaveLength(seeded.length);
  }, twoSeedRunsBudgetMs);
});
