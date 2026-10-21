// @ts-check
/** Disposable fixture admin/actor only. No arbitrary SQL or principal input. Never used by sampler. */
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { configuration } from "./sample.mjs";
/** @typedef {import('./sample.mjs').SourceClient} Client */
const commands = new Set([
  "setup",
  "connections",
  "disconnect_one",
  "lock",
  "release",
  "deadlock",
  "reset",
  "sampler_absent",
  "close",
]);
/** @param {(config: ReturnType<typeof configuration>) => Client} create */
export function fixture(create) {
  /** @type {Client|null} */ let admin = null;
  /** @type {Client|null} */ let a = null;
  /** @type {Client|null} */ let b = null;
  /** @type {Promise<unknown>|null} */ let pending = null;
  let deadline = 0;
  function remaining() {
    const left = deadline - performance.now();
    if (left <= 0) throw new Error("query_timeout");
    return left;
  }
  /** @param {Client} client @param {string} text */
  async function q(client, text) {
    const result = await client.query({
      text,
      rowMode: "array",
      query_timeout: Math.min(5000, Math.max(1, Math.floor(remaining()))),
    });
    if (result === null || typeof result !== "object" || !("rows" in result))
      throw new Error("malformed");
    return result;
  }
  async function connect() {
    const client = create({
      ...configuration("tracking_fixture", Math.min(4000, remaining())),
      user: "tracking",
      application_name: "inside-postgresql-source-fixture",
      options:
        "-c search_path=pg_catalog -c statement_timeout=5000 -c lock_timeout=2500",
    });
    try {
      await client.connect();
      return client;
    } catch (error) {
      try {
        await client.end();
      } catch {
        /* Preserve the original connect refusal. */
      }
      throw error;
    }
  }
  async function actors() {
    if (a === null) a = await connect();
    if (b === null) b = await connect();
  }
  /** @param {string} command @param {number} budgetMs */
  async function act(command, budgetMs) {
    if (
      !commands.has(command) ||
      !Number.isInteger(budgetMs) ||
      budgetMs <= 0 ||
      budgetMs > 10000
    )
      throw new Error("query_refused");
    deadline = performance.now() + budgetMs;
    if (command === "close") {
      const owned = [a, b, admin];
      a = b = admin = null;
      // Public end forcibly settles a non-pipeline active query; a pending rejection is already handled.
      const results = await Promise.allSettled(
        owned.filter((value) => value !== null).map((client) => client.end()),
      );
      if (pending !== null) await Promise.allSettled([pending]);
      pending = null;
      if (results.some((result) => result.status !== "fulfilled"))
        throw new Error("cleanup");
      return;
    }
    if (admin === null) admin = await connect();
    if (command === "setup") {
      const result = await q(
        admin,
        "SELECT current_setting('server_version_num'), current_database(), current_user",
      );
      if (JSON.stringify(result.rows) !== '[["180004","tracking","tracking"]]')
        throw new Error("ownership");
      for (const text of [
        "CREATE ROLE postgres_source_reader LOGIN PASSWORD 'postgres_source_fixture_reader' NOSUPERUSER NOINHERIT NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 1",
        "GRANT CONNECT ON DATABASE tracking TO postgres_source_reader",
        "ALTER ROLE postgres_source_reader SET default_transaction_read_only = on",
        "CREATE SCHEMA postgres_source_fixture",
        "CREATE TABLE postgres_source_fixture.lock_rows (id integer PRIMARY KEY, value integer NOT NULL)",
        "INSERT INTO postgres_source_fixture.lock_rows VALUES (1,0),(2,0)",
        "SELECT pg_catalog.pg_stat_reset()",
      ])
        await q(admin, text);
    } else if (command === "connections") await actors();
    else if (command === "disconnect_one") {
      if (b === null) throw new Error("query_refused");
      await b.end();
      b = null;
    } else if (command === "lock") {
      await actors();
      if (a === null || b === null) throw new Error("query_refused");
      await q(a, "BEGIN");
      await q(b, "BEGIN");
      await q(
        a,
        "UPDATE postgres_source_fixture.lock_rows SET value=value+1 WHERE id=1",
      );
      pending = q(
        b,
        "UPDATE postgres_source_fixture.lock_rows SET value=value+1 WHERE id=1",
      );
      // Register rejection immediately; the actual promise is checked by release/close.
      pending.catch(() => {});
    } else if (command === "release") {
      if (a === null || b === null || pending === null)
        throw new Error("query_refused");
      await q(a, "ROLLBACK");
      await pending;
      pending = null;
      await q(b, "ROLLBACK");
    } else if (command === "deadlock") {
      await actors();
      if (a === null || b === null) throw new Error("query_refused");
      for (const client of [a, b]) {
        await q(client, "BEGIN");
        await q(client, "SET LOCAL deadlock_timeout = '100ms'");
        await q(client, "SET LOCAL lock_timeout = '0'");
      }
      await q(
        a,
        "UPDATE postgres_source_fixture.lock_rows SET value=value+1 WHERE id=1",
      );
      await q(
        b,
        "UPDATE postgres_source_fixture.lock_rows SET value=value+1 WHERE id=2",
      );
      const results = await Promise.allSettled([
        q(
          a,
          "UPDATE postgres_source_fixture.lock_rows SET value=value+1 WHERE id=2",
        ),
        q(
          b,
          "UPDATE postgres_source_fixture.lock_rows SET value=value+1 WHERE id=1",
        ),
      ]);
      const failed = results.filter((result) => result.status === "rejected");
      /** @type {unknown} */ const reason = failed[0]?.reason;
      if (
        failed.length !== 1 ||
        reason === null ||
        typeof reason !== "object" ||
        !("code" in reason) ||
        reason.code !== "40P01"
      )
        throw new Error("query_refused");
      for (const client of [a, b]) await q(client, "ROLLBACK");
      await Promise.all([a.end(), b.end()]);
      a = b = null;
    } else if (command === "reset")
      await q(admin, "SELECT pg_catalog.pg_stat_reset()");
    else if (command === "sampler_absent") {
      const result = await q(
        admin,
        "SELECT count(*)::text FROM pg_catalog.pg_stat_activity WHERE datname='tracking' AND usename='postgres_source_reader' AND application_name='inside-postgresql-source'",
      );
      if (JSON.stringify(result.rows) !== '[["0"]]') throw new Error("cleanup");
    }
    remaining();
  }
  return { act };
}
export async function main() {
  if (
    process.version !== "v26.10.0" ||
    process.argv.length !== 2 ||
    Object.keys(process.env).some((key) => key !== "PATH")
  )
    throw new Error("credentials");
  const require = createRequire(
    new URL("../../apps/backend/package.json", import.meta.url),
  );
  // oxlint-disable typescript/no-unsafe-type-assertion
  const pg =
    /** @type {typeof import('../../apps/backend/test/support/proof-dependencies.js')} */ (
      require("pg")
    );
  // oxlint-enable typescript/no-unsafe-type-assertion
  const owner = fixture((config) => new pg.Client(config));
  let buffer = Buffer.alloc(0);
  let failed = false;
  /** @type {unknown} */ let primary;
  try {
    for await (const part of process.stdin) {
      buffer = Buffer.concat([buffer, part]);
      if (buffer.length > 512) throw new Error("malformed");
      const end = buffer.indexOf(10);
      if (end < 0) continue;
      if (end !== buffer.length - 1) throw new Error("malformed");
      const raw = buffer.toString("utf8");
      buffer = Buffer.alloc(0);
      // Canonical closed grammar rejects duplicate/extra keys before JSON parsing or use.
      if (
        !/^\{"command":"(setup|connections|disconnect_one|lock|release|deadlock|reset|sampler_absent|close)","budget_ms":[1-9][0-9]{0,4}\}\n$/.test(
          raw,
        )
      )
        throw new Error("malformed");
      /** @type {unknown} */ const settings = JSON.parse(raw);
      if (
        settings === null ||
        typeof settings !== "object" ||
        !("command" in settings) ||
        typeof settings.command !== "string" ||
        !("budget_ms" in settings) ||
        typeof settings.budget_ms !== "number"
      )
        throw new Error("malformed");
      await owner.act(settings.command, settings.budget_ms);
      process.stdout.write(
        JSON.stringify({
          schema: 1,
          command: settings.command,
          state: "done",
        }) + "\n",
      );
      if (settings.command === "close") return;
    }
    throw new Error("query_refused");
  } catch (error) {
    failed = true;
    primary = error;
  } finally {
    try {
      await owner.act("close", 10000);
    } catch (error) {
      if (!failed) {
        failed = true;
        primary = error;
      }
    }
  }
  if (failed) throw primary;
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  main().catch(() => {
    process.exitCode = 1;
  });
