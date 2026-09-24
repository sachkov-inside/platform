import { randomUUID } from "node:crypto";

import { Pool } from "pg";
import { inject } from "vitest";

import {
  createPrismaClient,
  type PlatformPrisma,
} from "../../../src/infrastructure/prisma/index.js";

export interface TestDatabase {
  readonly prisma: PlatformPrisma;
  readonly url: string;
  dispose(): Promise<void>;
}

export function createTestDatabase(): Promise<TestDatabase> {
  return createDatabase();
}

async function createDatabase(template?: string): Promise<TestDatabase> {
  const adminUrl = inject("postgresAdminUrl");
  const databaseName = `inside_test_${randomUUID().replaceAll("-", "")}`;
  const adminPool = new Pool({ connectionString: adminUrl, max: 1 });
  try {
    await adminPool.query(`CREATE DATABASE ${databaseName}${template === undefined ? "" : ` TEMPLATE ${template}`}`);
  } finally {
    await adminPool.end();
  }

  const url = new URL(adminUrl);
  url.pathname = `/${databaseName}`;
  const prisma = createPrismaClient(url.toString());

  return {
    prisma,
    url: url.toString(),
    async dispose() {
      await prisma.$disconnect();
      const cleanupPool = new Pool({ connectionString: adminUrl, max: 1 });
      await cleanupPool.query(`DROP DATABASE ${databaseName} WITH (FORCE)`);
      await cleanupPool.end();
    },
  };
}

/** База со схемой последней миграции: копия шаблона, мигрированного один раз на прогон. */
export function createMigratedTestDatabase(): Promise<TestDatabase> {
  return createDatabase(inject("postgresMigratedTemplate"));
}
