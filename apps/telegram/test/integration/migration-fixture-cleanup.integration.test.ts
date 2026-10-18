import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

import { createFixtureDatabase } from "../support/fixture-database.js";
import {
  createMigrationDatabase,
  type MigrationDatabaseFixture,
} from "../support/migration-database.js";
import { required } from "../support/required.js";

const databaseUrl = required(process.env["DATABASE_URL"]);
const name = `identity_cleanup_${randomUUID().replaceAll("-", "")}`;
const abort = new AbortController();
const owner = createFixtureDatabase(databaseUrl, `${name}_inspection`);
let fixture: MigrationDatabaseFixture | undefined;
let acquisition: Promise<MigrationDatabaseFixture> | undefined;
let blocked: Promise<unknown> | undefined;
beforeAll(async () => {
  acquisition = createMigrationDatabase(databaseUrl, name, {
    signal: abort.signal,
  });
  fixture = await acquisition;
});
afterAll(async () => {
  abort.abort(new Error("Blocked migration fixture cleanup"));
  try {
    const acquired = fixture ?? (await acquisition?.catch(() => undefined));
    await acquired?.close();
    await blocked?.catch(() => undefined);
  } finally {
    await owner.destroy();
  }
});

it("terminates an owned PostgreSQL advisory-lock wait and removes the database before cleanup returns", async () => {
  const database = required(fixture).database;
  let holderPid: number | undefined;
  blocked = database.transaction().execute(async (holder) => {
    const result = await sql<{
      pid: number;
    }>`select pg_backend_pid() as pid`.execute(holder);
    holderPid = required(result.rows[0]).pid;
    await sql`select pg_advisory_xact_lock(1392)`.execute(holder);
    // Another real connection waits for this transaction. A pool close alone cannot drain it.
    await sql`select pg_advisory_xact_lock(1392)`.execute(database);
  });
  const outcome = blocked.then(
    () => ({ kind: "completed" as const }),
    (error: unknown) => ({ kind: "rejected" as const, error }),
  );
  await vi.waitFor(async () => {
    const result = await sql<{ blocking: number[] }>`
      select pg_blocking_pids(pid) as blocking from pg_stat_activity
      where datname = ${name} and wait_event = 'advisory'
    `.execute(owner);
    expect(
      result.rows.some((row) => row.blocking.includes(required(holderPid))),
    ).toBe(true);
  });
  abort.abort(new Error("Intentional blocked migration cancellation"));
  await required(fixture).close();
  const settled = await outcome;
  expect(settled.kind).toBe("rejected");
  if (settled.kind === "rejected") expect(settled.error).toBeInstanceOf(Error);
  const remaining = await sql<{ exists: boolean }>`select exists (
    select 1 from pg_database where datname = ${name}
  ) as exists`.execute(owner);
  expect(required(remaining.rows[0]).exists).toBe(false);
});

it("keeps the shared runtime fixture usable after blocked migration cancellation", async () => {
  await expect(
    sql`select 1 from identity_link_recoveries limit 1`.execute(owner),
  ).resolves.toBeDefined();
});

it("preserves an existing database when acquiring its duplicate name fails", async ({
  signal,
  onTestFinished,
}) => {
  const duplicate = `identity_duplicate_${randomUUID().replaceAll("-", "")}`;
  const existing = await createMigrationDatabase(databaseUrl, duplicate, {
    signal,
  });
  onTestFinished(() => existing.close());
  await sql`create table acquisition_marker (value text); insert into acquisition_marker values ('original fixture')`.execute(
    existing.database,
  );
  await expect(
    createMigrationDatabase(databaseUrl, duplicate),
  ).rejects.toMatchObject({ code: "42P04" });
  const marker = await sql<{
    value: string;
  }>`select value from acquisition_marker`.execute(existing.database);
  expect(required(marker.rows[0]).value).toBe("original fixture");
});
