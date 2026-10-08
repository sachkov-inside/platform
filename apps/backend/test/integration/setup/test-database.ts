import { randomUUID } from "node:crypto";

import { Pool } from "pg";
import { inject } from "vitest";

import {
  createPrismaClient,
  type PlatformPrisma,
} from "../../../src/infrastructure/prisma/index.js";
import { guardTransactionConnections } from "./transaction-guard.js";

export interface TestDatabase {
  /** Fails a query through itself inside its own `$transaction` callback: see `transaction-guard.ts`. */
  readonly prisma: PlatformPrisma;
  readonly url: string;
  /** Owns a multi-query operation until it settles, even if the test stops awaiting it. */
  run<Result>(work: () => Promise<Result>): Promise<Result>;
  /** Waits for owned operations before the next test uses the database. */
  drain(): Promise<void>;
  /** Also fails with the first query the client refused inside a transaction. */
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
    await adminPool.query(
      `CREATE DATABASE ${databaseName}${template === undefined ? "" : ` TEMPLATE ${template}`}`,
    );
  } finally {
    await adminPool.end();
  }

  const url = new URL(adminUrl);
  url.pathname = `/${databaseName}`;
  const { prisma, refused } = guardTransactionConnections(
    createPrismaClient(url.toString()),
  );
  const running = new Set<Promise<unknown>>();
  let disposing = false;

  async function drain(): Promise<void> {
    await Promise.allSettled([...running]);
  }

  return {
    prisma,
    url: url.toString(),
    run<Result>(work: () => Promise<Result>): Promise<Result> {
      if (disposing)
        return Promise.reject(new Error("Test database is disposing"));
      const operation = Promise.resolve()
        .then(work)
        .finally(() => {
          running.delete(operation);
        });
      running.add(operation);
      return operation;
    },
    drain,
    async dispose() {
      disposing = true;
      await drain();
      await prisma.$disconnect();
      const cleanupPool = new Pool({ connectionString: adminUrl, max: 1 });
      try {
        // pg Pool.end() can resolve before idle clients finish disconnecting.
        // DROP without FORCE lets PostgreSQL wait for them and reports leaked
        // connections instead of sending 57P01 to a client still shutting down.
        await cleanupPool.query(`DROP DATABASE ${databaseName}`);
      } finally {
        await cleanupPool.end();
      }
      const [first] = refused;
      if (first !== undefined) throw first;
    },
  };
}

/** База со схемой последней миграции: копия шаблона, мигрированного один раз на прогон. */
export function createMigratedTestDatabase(): Promise<TestDatabase> {
  return createDatabase(inject("postgresMigratedTemplate"));
}
