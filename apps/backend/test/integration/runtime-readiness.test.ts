import { afterEach, describe, expect, test } from "vitest";

import { Prisma } from "../../src/infrastructure/prisma/index.js";
import { OperationalReadiness } from "../../src/infrastructure/operational-readiness.js";
import { acquireWorkerGenerationLease } from "../../src/infrastructure/worker-runtime.js";
import { platformMigrations } from "../../src/migrations/index.js";
import { migrateRuntimeDatabase } from "../../src/migrations/migrate.js";
import {
  createMigratedTestDatabase,
  createTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

describe("production runtime readiness", () => {
  const databases: TestDatabase[] = [];

  afterEach(async () => {
    await Promise.all(databases.splice(0).map((database) => database.dispose()));
  });

  test("binds readiness to the exact release and complete schema", async () => {
    const database = await createMigratedTestDatabase();
    databases.push(database);
    const readiness = new OperationalReadiness(database.prisma, {
      release: "v7",
      sourceSha: "7".repeat(40),
    });

    await expect(readiness.check("api")).resolves.toMatchObject({
      database: "reachable",
      process: "api",
      release: { release: "v7", sourceSha: "7".repeat(40) },
      schema: { migrationCount: platformMigrations.length },
      status: "ready",
    });

    await database.prisma.$executeRaw(
      Prisma.sql`delete from public.platform_migrations where position = ${platformMigrations.length}`,
    );
    await expect(readiness.check("api")).rejects.toThrow(
      `Expected ${platformMigrations.length} Platform migrations, received ${platformMigrations.length - 1}`,
    );
  });

  test("resumes PgBoss initialization after Platform migrations succeeded", async () => {
    const database = await createTestDatabase();
    databases.push(database);

    await expect(
      migrateRuntimeDatabase(database.url, {
        afterPlatformMigrations() {
          throw new Error("simulated process loss before PgBoss migration");
        },
      }),
    ).rejects.toThrow("simulated process loss before PgBoss migration");

    const outcome = await migrateRuntimeDatabase(database.url);
    expect(outcome).toMatchObject({
      appliedMigrations: [],
    });
    expect(typeof outcome.jobSchemaVersion).toBe("number");
  });

  test("prevents two generations of the same worker from overlapping", async () => {
    const database = await createTestDatabase();
    databases.push(database);
    const oldGeneration = await acquireWorkerGenerationLease(
      database.url,
      "material-assets-worker",
    );

    await expect(
      acquireWorkerGenerationLease(database.url, "material-assets-worker"),
    ).rejects.toThrow(
      "Another material-assets-worker generation is still active",
    );

    await oldGeneration.release();
    const newGeneration = await acquireWorkerGenerationLease(
      database.url,
      "material-assets-worker",
    );
    await newGeneration.release();
  });
});
