import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { Database, DatabaseSchema } from "../../src/database/database.js";
import { destroyTestDatabase } from "../support/destroy-test-database.js";
import { required } from "../support/required.js";

let owner: Pool;
let database: Database | undefined;
let pool: Pool;
let name: string | undefined;
let url: URL;
// PostgreSQL waits about five seconds before reporting a live backend (55006).
const liveBackendFailureBudgetMs = 10_000;

beforeEach(async () => {
  database = undefined;
  name = undefined;
  url = new URL(required(process.env["DATABASE_URL"]));
  owner = new Pool({ connectionString: url.toString(), max: 1 });
  const candidate = `teardown_${randomUUID().replaceAll("-", "")}`;
  await owner.query(`CREATE DATABASE ${candidate}`);
  name = candidate;
  url.pathname = `/${candidate}`;
  pool = new Pool({ connectionString: url.toString(), max: 1 });
  database = new Kysely<DatabaseSchema>({
    dialect: new PostgresDialect({ pool }),
  });
});

afterEach(async () => {
  try {
    await database?.destroy();
    if (name !== undefined)
      await owner.query(`DROP DATABASE IF EXISTS ${name}`);
  } finally {
    await owner.end();
  }
});

it("removes the fixture database after pool shutdown without client errors", async () => {
  const errors: unknown[] = [];
  pool.on("error", (error: unknown) => errors.push(error));
  await sql`select 1`.execute(required(database));
  const client = await pool.connect();
  const disconnected = new Promise<void>((resolve) => {
    client.once("end", resolve);
  });
  client.release();

  await destroyTestDatabase(required(database), owner, required(name));
  name = undefined;
  await disconnected;
  expect(errors).toEqual([]);
  const removed = await owner.query(
    "SELECT 1 FROM pg_database WHERE datname = $1",
    [url.pathname.slice(1)],
  );
  expect(removed.rows).toEqual([]);
});

it(
  "reports a leaked connection without terminating it and can clean up after it closes",
  async () => {
    const leaked = new Pool({ connectionString: url.toString(), max: 1 });
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
      await leaked.end();
    }
    await destroyTestDatabase(required(database), owner, required(name));
    name = undefined;
  },
  liveBackendFailureBudgetMs,
);
