import { afterEach, describe, expect, test } from "vitest";

import { Prisma } from "../../src/infrastructure/prisma/index.js";
import { OperationalReadiness } from "../../src/infrastructure/operational-readiness.js";
import { migrationChecksum } from "../../src/infrastructure/postgres/migrate-to-latest.js";
import { acquireWorkerGenerationLease } from "../../src/infrastructure/worker-runtime.js";
import { platformMigrations } from "../../src/migrations/index.js";
import {
  expectedPgBossSchemaVersion,
  migrateRuntimeDatabase,
  runtimeDatabaseSchemaIdentity,
  verifyRuntimeDatabaseSchema,
} from "../../src/migrations/migrate.js";
import {
  createTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

describe("production runtime readiness", () => {
  const databases: TestDatabase[] = [];

  afterEach(async () => {
    await Promise.all(databases.splice(0).map((database) => database.dispose()));
  });

  test("binds readiness to the exact release and complete schema", async () => {
    const database = await createTestDatabase();
    databases.push(database);
    await migrateRuntimeDatabase(database.url);
    const readiness = new OperationalReadiness(
      database.prisma,
      {
        release: "v7",
        sourceSha: "7".repeat(40),
      },
    );

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

  test("reads readiness schema through the supplied application connection", async () => {
    const database = await createTestDatabase();
    databases.push(database);
    await migrateRuntimeDatabase(database.url);
    await database.prisma.$transaction(async (connection) => {
      await connection.$executeRaw(
        Prisma.sql`update pgboss.version set version = ${expectedPgBossSchemaVersion - 1}`,
      );
      const readiness = new OperationalReadiness(
        connection,
        { release: "v7", sourceSha: "7".repeat(40) },
      );
      await expect(readiness.check("api")).rejects.toThrow("Expected PgBoss schema");
      await expect(readiness.check("mcp")).rejects.toThrow("Expected PgBoss schema");
    });
  });

  test("verifies the exact current runtime schema without changing the database", async () => {
    const database = await createTestDatabase();
    databases.push(database);

    await expect(
      verifyRuntimeDatabaseSchema(
        database.url,
        runtimeDatabaseSchemaIdentity([], null),
      ),
    ).resolves.toMatchObject({ appliedMigrations: [], jobSchemaVersion: null });
    await migrateRuntimeDatabase(database.url);
    const expectedIdentity = runtimeDatabaseSchemaIdentity(
      platformMigrations,
      expectedPgBossSchemaVersion,
    );
    await expect(
      verifyRuntimeDatabaseSchema(database.url, expectedIdentity),
    ).resolves.toMatchObject({
      appliedMigrations: platformMigrations.map(({ name }) => name),
      identity: expectedIdentity,
      jobSchemaVersion: expectedPgBossSchemaVersion,
    });

    const finalMigration = platformMigrations.at(-1);
    if (finalMigration === undefined) {
      throw new Error("Runtime readiness requires at least one migration");
    }
    await database.prisma.$executeRaw(
      Prisma.sql`delete from public.platform_migrations where position = ${platformMigrations.length}`,
    );
    await expect(
      verifyRuntimeDatabaseSchema(database.url, expectedIdentity),
    ).rejects.toThrow(
      "Runtime database schema identity does not match the deployed release",
    );
    await database.prisma.$executeRaw(Prisma.sql`
      insert into public.platform_migrations (name, position, checksum)
      values (
        ${finalMigration.name},
        ${platformMigrations.length},
        ${migrationChecksum(finalMigration.statement)}
      )
    `);

    await database.prisma.$executeRaw(
      Prisma.sql`update pgboss.version set version = ${expectedPgBossSchemaVersion - 1}`,
    );
    await expect(
      verifyRuntimeDatabaseSchema(database.url, expectedIdentity),
    ).rejects.toThrow(
      "Runtime database schema identity does not match the deployed release",
    );
    await database.prisma.$executeRaw(
      Prisma.sql`update pgboss.version set version = ${expectedPgBossSchemaVersion}`,
    );

    await database.prisma.$executeRaw(Prisma.sql`
      update public.platform_migrations
      set checksum = repeat('0', 64)
      where position = 1
    `);
    await expect(
      verifyRuntimeDatabaseSchema(database.url, expectedIdentity),
    ).rejects.toThrow(`Migration checksum mismatch: ${platformMigrations[0]?.name}`);
  });

  test("rejects a non-empty database without a migration ledger", async () => {
    const database = await createTestDatabase();
    databases.push(database);
    await database.prisma.$executeRaw(Prisma.sql`
      create table public.legacy_platform_state (id integer primary key)
    `);

    await expect(
      verifyRuntimeDatabaseSchema(
        database.url,
        runtimeDatabaseSchemaIdentity([], null),
      ),
    ).rejects.toThrow("Migration ledger is missing from a non-empty database");
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
