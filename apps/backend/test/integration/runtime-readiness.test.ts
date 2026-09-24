import { afterEach, describe, expect, test, vi } from "vitest";

import { Prisma } from "../../src/infrastructure/prisma/index.js";
import { OperationalReadiness } from "../../src/infrastructure/operational-readiness.js";
import { migrationChecksum } from "../../src/infrastructure/postgres/migrate-to-latest.js";
import {
  acquireWorkerGenerationLease,
  runWorker,
} from "../../src/infrastructure/worker-runtime.js";
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
    vi.restoreAllMocks();
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

  test("reports the failure that stopped a worker even when its drain fails", async () => {
    const database = await createTestDatabase();
    databases.push(database);
    await migrateRuntimeDatabase(database.url);
    const failure = Promise.reject(new Error("notification_broker_disconnected"));
    // Воркер держит обработчик своего отказа сразу, как `assembleNotificationWorker`.
    void failure.catch(() => undefined);
    let drained = false;

    // Остановка после отказа — следствие, а не причина: её собственный срок не должен заменить
    // собой то, из-за чего воркер остановился.
    await expect(
      runWorker({
        application: { close: () => Promise.resolve() },
        databaseUrl: database.url,
        failed: failure,
        jobs: {
          start: () => Promise.resolve(),
          stop() {
            drained = true;
            return Promise.reject(new Error("notification_drain_timeout"));
          },
        },
        process: "notifications-worker",
        readiness: new OperationalReadiness(database.prisma, {
          release: "development",
          sourceSha: "0".repeat(40),
        }),
        registerJobs: () => Promise.resolve(),
      }),
    ).rejects.toThrow("notification_broker_disconnected");
    expect(drained).toBe(true);
  });

  test("reports the failure that stopped a worker even when its cleanup fails", async () => {
    const database = await createTestDatabase();
    databases.push(database);
    await migrateRuntimeDatabase(database.url);
    const failure = Promise.reject(new Error("notification_broker_disconnected"));
    void failure.catch(() => undefined);
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(
      runWorker({
        application: { close: () => Promise.reject(new Error("close failed for postgresql://inside:db-secret@db:5432/inside")) },
        databaseUrl: database.url,
        failed: failure,
        jobs: { start: () => Promise.resolve(), stop: () => Promise.reject(new Error("drain")) },
        process: "notifications-worker",
        readiness: new OperationalReadiness(database.prisma, {
          release: "development",
          sourceSha: "0".repeat(40),
        }),
        registerJobs: () => Promise.resolve(),
      }),
    ).rejects.toThrow("notification_broker_disconnected");
    // Оба сбоя названы кодом и причиной; учётные данные адреса в журнал не попадают, а lease
    // освобождён несмотря на сбой закрытия.
    const records = logged.mock.calls.map(([line]) => JSON.parse(String(line)) as unknown);
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      event: "worker_stop_failed",
      process: "notifications-worker",
      reason: "worker_drain_failed",
      status: "operator_attention",
      error: { type: "Error", message: "drain" },
    });
    expect(records[1]).toMatchObject({
      event: "worker_stop_failed",
      process: "notifications-worker",
      reason: "worker_close_failed",
      status: "operator_attention",
      error: { message: "close failed for postgresql://[redacted]@db:5432/inside" },
    });
    expect(JSON.stringify(logged.mock.calls)).not.toContain("db-secret");
    const nextGeneration = await acquireWorkerGenerationLease(database.url, "notifications-worker");
    await nextGeneration.release();
  });
});
