import { readFile } from "node:fs/promises";

import { PostgresDialect, generate } from "kysely-codegen";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

describe("generated database types", () => {
  let testDatabase: TestDatabase;

  beforeAll(async () => {
    testDatabase = await createMigratedTestDatabase();
  });

  afterAll(async () => {
    await testDatabase.dispose();
  });

  test("match a clean database built from checked-in migrations", async () => {
    const generated = await generate({
      db: testDatabase.database,
      dialect: new PostgresDialect(),
      excludePattern: "kysely_*",
      outFile: null,
      print: false,
      typeOnlyImports: true,
    });
    const checkedIn = await readFile(
      new URL("../../src/infrastructure/postgres/generated/database.ts", import.meta.url),
      "utf8",
    );

    expect(generated).toBe(checkedIn);
  });
});
