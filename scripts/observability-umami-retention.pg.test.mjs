// @ts-check
// Schema-only PostgreSQL proof: exact pinned upstream migrations, no Umami app/API.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { z } from "zod";

const requireBackend = createRequire(
  new URL("../apps/backend/package.json", import.meta.url),
);
/* oxlint-disable typescript/no-unsafe-type-assertion -- owning test dependencies supply these types. */
const { Client } =
  /** @type {typeof import("../apps/backend/test/support/proof-dependencies.js")} */ (
    requireBackend("pg")
  );
const { PostgreSqlContainer } =
  /** @type {typeof import("../apps/backend/test/support/proof-dependencies.js")} */ (
    requireBackend("@testcontainers/postgresql")
  );
/* oxlint-enable typescript/no-unsafe-type-assertion */
const scripts = fileURLToPath(
  new URL("./observability-umami", import.meta.url),
);
const config = new URL("../infra/observability/umami/", import.meta.url);
const PG_STARTUP_MILLISECONDS = 60_000;
const PG_QUERY_MILLISECONDS = 12_000;
const PG_CLEANUP_MILLISECONDS = 10_000;
const PYTHON_COMMAND_MILLISECONDS = 5_000;
const FIXTURE_MILLISECONDS = 150_000;
const site = "00000000-0000-4000-8000-000000001566";
const lockSchema = z.object({
  images: z.object({
    postgres: z.string().regex(/^postgres:16\.13-alpine@sha256:[a-f0-9]{64}$/u),
  }),
});
const queryResult = z.array(
  z.object({ rows: z.array(z.object({ json_build_object: z.unknown() })) }),
);
const counters = z.record(z.string(), z.number().int().nonnegative());
const parsedBatch = z.tuple([
  z.object({ cutoff: z.string() }),
  z.object({ remaining_expired_events: z.number().int().nonnegative() }),
  counters,
]);

/** @param {string} body @param {string[]} [args] @param {string} [input] */
function python(body, args = [], input = "") {
  const result = spawnSync(
    "python3",
    [
      "-c",
      "import sys,json;sys.path.insert(0,sys.argv[1]);import retention,retention_fixture;" +
        body,
      scripts,
      ...args,
    ],
    {
      input,
      encoding: "utf8",
      timeout: PYTHON_COMMAND_MILLISECONDS,
      maxBuffer: 262_144,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    },
  );
  assert.equal(result.status, 0, "bounded retention Python contract failed");
  return result.stdout;
}
/** @param {unknown} value */
function encodedRows(value) {
  return queryResult
    .parse(Array.isArray(value) ? value : [value])
    .flatMap((result) => result.rows)
    .map((row) => JSON.stringify(row.json_build_object))
    .join("\n");
}

// Integration contract: dedicated Testcontainers database, bounded queries, no app/foreign stand.
test(
  "pinned Umami SQL drains bounded batches, preserves boundary/concurrent data and fails closed on locks",
  { timeout: FIXTURE_MILLISECONDS },
  async () => {
    let stage = "acquisition";
    const lock = lockSchema.parse(
      JSON.parse(await readFile(new URL("inputs.lock.json", config), "utf8")),
    );
    const password = randomBytes(24).toString("hex");
    const container = await new PostgreSqlContainer(lock.images.postgres)
      .withUsername("pilot_bootstrap")
      .withPassword(password)
      .withDatabase("postgres")
      .withResourcesQuota({ memory: 0.5, cpu: 0.5 })
      .withStartupTimeout(PG_STARTUP_MILLISECONDS)
      .start()
      .catch(() => {
        throw new Error("schema-only retention PostgreSQL acquisition failed");
      });
    /** @type {InstanceType<typeof Client>[]} */
    const clients = [];
    /** @param {string} connectionString */
    async function connect(connectionString) {
      const client = new Client({
        connectionString,
        query_timeout: PG_QUERY_MILLISECONDS,
        connectionTimeoutMillis: PG_QUERY_MILLISECONDS,
      });
      clients.push(client);
      await client.connect();
      return client;
    }
    /** @type {string | undefined} */
    let failureStage;
    let cleanupFailed = false;
    try {
      stage = "isolated-role";
      const bootstrap = await connect(container.getConnectionUri());
      await bootstrap.query(
        "CREATE ROLE umami LOGIN PASSWORD '" +
          password +
          "' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 8",
      );
      await bootstrap.query("CREATE DATABASE umami OWNER umami");
      const address = new URL(container.getConnectionUri());
      address.username = "umami";
      address.password = password;
      address.pathname = "/umami";
      const database = await connect(address.toString());
      stage = "pinned-schema";
      await database.query(
        await readFile(new URL("schema-fixture.sql", config), "utf8"),
      );
      await database.query(
        "INSERT INTO website(website_id,name,domain) VALUES($1,'fixture','fixture.invalid')",
        [site],
      );
      stage = "synthetic-corpus";
      const seed = encodedRows(
        await database.query(
          python("print(retention_fixture.seed_sql(sys.argv[2]))", [site]),
        ),
      );
      const cutoff = python(
        "print(retention_fixture.seed_result(sys.stdin.read()))",
        [],
        seed,
      ).trim();
      const sql = python("print(retention.batch_sql(sys.argv[2]))", [cutoff]);
      const writer = await connect(address.toString());
      // Per-batch connections match psql lifetime: error/timeout always rolls back on close.
      async function batch() {
        const client = await connect(address.toString());
        try {
          // Prove SQL chooses UTC even when the connection's default timezone differs.
          await client.query("SET TIME ZONE 'Pacific/Auckland'");
          const raw = encodedRows(await client.query(sql));
          return parsedBatch.parse(
            JSON.parse(
              python(
                "print(json.dumps(retention.parse_batch(sys.stdin.read())))",
                [],
                raw,
              ),
            ),
          );
        } finally {
          await client.end();
          clients.splice(clients.indexOf(client), 1);
        }
      }
      stage = "lock-rollback";
      await writer.query("BEGIN");
      await writer.query(
        "SELECT event_id FROM website_event WHERE event_name='ttl_expired' LIMIT 1 FOR UPDATE",
      );
      await assert.rejects(batch());
      await writer.query("ROLLBACK");
      const rollbackRows = await database.query(
        "SELECT count(*)::int AS count FROM event_data WHERE data_key='fixture'",
      );
      assert.equal(counters.parse(rollbackRows.rows[0])["count"], 502);
      stage = "advisory-ownership";
      await writer.query("BEGIN");
      await writer.query("SELECT pg_advisory_xact_lock(1566,365)");
      await assert.rejects(batch());
      await writer.query("ROLLBACK");
      stage = "bounded-batches";
      const first = await batch();
      const removedEvents = z
        .number()
        .int()
        .nonnegative()
        .parse(first[2]["website_event"]);
      assert.ok(removedEvents > 0 && removedEvents <= 500);
      assert.ok(first[1].remaining_expired_events > 0);
      stage = "concurrent-recent-insert";
      const next = batch();
      await writer.query(
        "INSERT INTO website_event(event_id,website_id,session_id,visit_id,created_at,url_path,event_type,event_name) VALUES(md5('ttl-concurrent')::uuid,$1,md5('ttl-session-recent')::uuid,md5('ttl-concurrent-visit')::uuid,current_timestamp,'/ttl/concurrent',2,'ttl_concurrent')",
        [site],
      );
      let result = await next;
      for (
        let passes = 0;
        Object.values(result[2]).some(Boolean) && passes < 6;
        passes++
      )
        result = await batch();
      assert.equal(Object.values(result[2]).some(Boolean), false);
      assert.equal(result[1].remaining_expired_events, 0);
      stage = "post-cleanup-corpus";
      const proof = encodedRows(
        await database.query(python("print(retention_fixture.proof_sql())")),
      );
      python("retention_fixture.proof_result(sys.stdin.read())", [], proof);
      const recent = await database.query(
        "SELECT count(*)::int AS count FROM website_event WHERE event_name='ttl_concurrent'",
      );
      assert.equal(counters.parse(recent.rows[0])["count"], 1);
      stage = "idempotent-retry";
      assert.equal(Object.values((await batch())[2]).some(Boolean), false);
      stage = "future-cutoff-rejected";
      const future = python(
        "print(retention.batch_sql('2099-01-01T00:00:00.000000Z'))",
      );
      const futureClient = await connect(address.toString());
      await assert.rejects(futureClient.query(future));
      stage = "role-database-rejected";
      const forbidden = await connect(container.getConnectionUri());
      await assert.rejects(forbidden.query(sql));
    } catch {
      // Neither pg errors nor connection URIs/passwords enter logs/artifacts.
      failureStage = stage;
    } finally {
      const closed = await Promise.allSettled(
        clients.map((client) => client.end()),
      );
      const stopped = await Promise.allSettled([
        container.stop({
          timeout: PG_CLEANUP_MILLISECONDS,
          remove: true,
          removeVolumes: true,
        }),
      ]);
      cleanupFailed = [...closed, ...stopped].some(
        (result) => result.status === "rejected",
      );
    }
    if (cleanupFailed)
      throw new Error(
        "schema-only retention owned PostgreSQL cleanup failed" +
          (failureStage ? " after " + failureStage : ""),
      );
    if (failureStage !== undefined)
      throw new Error(
        "schema-only retention PostgreSQL proof failed at " + failureStage,
      );
  },
);
