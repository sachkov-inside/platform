import { randomUUID } from "node:crypto";

import { Pool } from "pg";
import { inject } from "vitest";

import {
  createPlatformDatabase,
  type PlatformDatabase,
} from "../../../src/infrastructure/postgres/index.js";
import { migrateToLatest } from "../../../src/migrations/index.js";

export interface TestDatabase {
  readonly database: PlatformDatabase;
  readonly url: string;
  dispose(): Promise<void>;
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const adminUrl = inject("postgresAdminUrl");
  const databaseName = `inside_test_${randomUUID().replaceAll("-", "")}`;
  const adminPool = new Pool({ connectionString: adminUrl, max: 1 });
  await adminPool.query(`CREATE DATABASE ${databaseName}`);
  await adminPool.end();

  const url = new URL(adminUrl);
  url.pathname = `/${databaseName}`;
  const database = createPlatformDatabase(url.toString());

  return {
    database,
    url: url.toString(),
    async dispose() {
      await database.destroy();
      const cleanupPool = new Pool({ connectionString: adminUrl, max: 1 });
      await cleanupPool.query(`DROP DATABASE ${databaseName} WITH (FORCE)`);
      await cleanupPool.end();
    },
  };
}

export async function createMigratedTestDatabase(): Promise<TestDatabase> {
  const testDatabase = await createTestDatabase();
  await migrateToLatest(testDatabase.database);
  return testDatabase;
}
