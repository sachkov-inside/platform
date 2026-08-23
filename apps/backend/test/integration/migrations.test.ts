import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { migrateToLatest } from "../../src/migrations/index.js";
import {
  createTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

describe("material authoring migrations", () => {
  let testDatabase: TestDatabase;

  beforeAll(async () => {
    testDatabase = await createTestDatabase();
  });

  afterAll(async () => {
    await testDatabase.dispose();
  });

  test("build an empty PostgreSQL database and replay without changes", async () => {
    const first = await migrateToLatest(testDatabase.database);
    const second = await migrateToLatest(testDatabase.database);

    expect(first).toEqual({
      appliedMigrations: ["0001_content_authoring", "0002_material_lifecycle"],
    });
    expect(second).toEqual({ appliedMigrations: [] });

    const tables = await testDatabase.database.introspection.getTables();
    const contentTables = tables
      .map(({ name }) => name)
      .filter((name) => !name.startsWith("kysely_"))
      .sort();

    expect(contentTables).toEqual([
      "authoring_idempotency",
      "formats",
      "material_publication_events",
      "material_revision_series_memberships",
      "material_revision_tags",
      "material_revisions",
      "material_search_documents",
      "material_tags",
      "materials",
      "published_material_series_memberships",
      "published_material_tags",
      "published_materials",
      "series",
      "series_memberships",
      "tags",
      "topics",
    ]);
  });
});
