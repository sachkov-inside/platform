import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import { beforeEach, expect, it } from "vitest";
import { migrationDatabaseLifecycleBudgetMilliseconds } from "../support/migration-database.js";
import type { Database, DatabaseSchema } from "../../src/database/database.js";
import { destroyTestDatabase } from "../support/destroy-test-database.js";
import { required } from "../support/required.js";

interface TeardownFixture {
  owner: Pool;
  database: Database;
  pool: Pool;
  name: string;
  url: URL;
}
let fixture: TeardownFixture;
// These cases measure administrative DROP, including PostgreSQL's live-backend wait.
const databaseAdministrationContractBudgetMs =
  migrationDatabaseLifecycleBudgetMilliseconds;
const administrationStatementTimeoutMs = 15_000;
const administrationResponseTimeoutMs = 20_000;
const administrationConnectionTimeoutMs = 5_000;

beforeEach(async ({ onTestFinished }) => {
  const url = new URL(required(process.env["DATABASE_URL"]));
  const owner = new Pool({
    connectionString: url.toString(),
    max: 1,
    connectionTimeoutMillis: administrationConnectionTimeoutMs,
    statement_timeout: administrationStatementTimeoutMs,
    lock_timeout: administrationStatementTimeoutMs,
    query_timeout: administrationResponseTimeoutMs,
  });
  // Native cleanup runs in reverse order and continues after an independent disposer fails.
  onTestFinished(() => owner.end(), databaseAdministrationContractBudgetMs);
  const name = `teardown_${randomUUID().replaceAll("-", "")}`;
  let acquired = false;
  onTestFinished(async () => {
    if (acquired) await owner.query(`DROP DATABASE IF EXISTS ${name}`);
  }, databaseAdministrationContractBudgetMs);
  await owner.query(`CREATE DATABASE ${name}`);
  acquired = true;
  url.pathname = `/${name}`;
  const pool = new Pool({ connectionString: url.toString(), max: 1 });
  const databaseOwner: { database?: Database } = {};
  onTestFinished(
    () => databaseOwner.database?.destroy() ?? pool.end(),
    databaseAdministrationContractBudgetMs,
  );
  const database = new Kysely<DatabaseSchema>({
    dialect: new PostgresDialect({ pool }),
  });
  databaseOwner.database = database;
  fixture = { owner, database, pool, name, url };
}, databaseAdministrationContractBudgetMs);

it(
  "removes the fixture database after pool shutdown without client errors",
  async () => {
    const { owner, database, pool, name, url } = fixture;
    const errors: unknown[] = [];
    pool.on("error", (error: unknown) => errors.push(error));
    await sql`select 1`.execute(required(database));
    const client = await pool.connect();
    const disconnected = new Promise<void>((resolve) => {
      client.once("end", resolve);
    });
    client.release();

    await destroyTestDatabase(required(database), owner, required(name));
    await disconnected;
    expect(errors).toEqual([]);
    const removed = await owner.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [url.pathname.slice(1)],
    );
    expect(removed.rows).toEqual([]);
  },
  databaseAdministrationContractBudgetMs,
);

it(
  "reports a leaked connection without terminating it and can clean up after it closes",
  async ({ onTestFinished }) => {
    const { owner, database, name, url } = fixture;
    const leaked = new Pool({ connectionString: url.toString(), max: 1 });
    let closing: Promise<void> | undefined;
    const closeLeaked = () => (closing ??= leaked.end());
    onTestFinished(closeLeaked, databaseAdministrationContractBudgetMs);
    const errors: unknown[] = [];
    leaked.on("error", (error: unknown) => errors.push(error));
    try {
      await sql`select 1`.execute(required(database));
      await leaked.query("SELECT 1");
      await expect(
        destroyTestDatabase(required(database), owner, required(name)),
      ).rejects.toMatchObject({ code: "55006" });
      expect((await leaked.query("SELECT 1 AS value")).rows).toEqual([
        { value: 1 },
      ]);
      expect(errors).toEqual([]);
    } finally {
      await closeLeaked();
    }
    await destroyTestDatabase(required(database), owner, required(name));
  },
  databaseAdministrationContractBudgetMs,
);
