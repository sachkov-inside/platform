import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { migrateToLatest } from "../../src/infrastructure/postgres/index.js";
import {
  createTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

describe("content authoring migrations", () => {
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

    expect(first).toEqual({ appliedMigrations: ["0001_content_authoring"] });
    expect(second).toEqual({ appliedMigrations: [] });

    const tables = await testDatabase.database.introspection.getTables();
    const contentTables = tables
      .map(({ name }) => name)
      .filter((name) => !name.startsWith("kysely_"))
      .sort();

    expect(contentTables).toEqual([
      "authoring_idempotency",
      "formats",
      "material_revision_series_memberships",
      "material_revision_tags",
      "material_revisions",
      "material_tags",
      "materials",
      "series",
      "series_memberships",
      "tags",
      "topics",
    ]);
  });
});
