// @ts-check
import assert from "node:assert/strict";
import { test } from "node:test";
import { fixture } from "./fixture.mjs";
test("fixture connect cleanup keeps its actual first private failure", async () => {
  const primary = new Error("controlled connect"),
    secondary = new Error("controlled end");
  const owner = fixture(() => ({
    connect: async () => {
      throw primary;
    },
    query: async () => {
      throw new Error("unexpected query");
    },
    end: async () => {
      throw secondary;
    },
  }));
  await assert.rejects(owner.act("setup", 1000), (error) => error === primary);
});
test("ordinary source module imports and explicit invalid fixture commands allocate no clients", async () => {
  let clients = 0;
  const owner = fixture(() => {
    clients += 1;
    throw new Error("controlled allocation");
  });
  assert.equal(clients, 0);
  await assert.rejects(owner.act("arbitrary SQL", 1000));
  assert.equal(clients, 0);
});

test("setup exposes only the last fixed operation while preserving opaque failures and SQL order", async () => {
  const phases = [
    "baseline_setup_connect",
    "baseline_setup_identity",
    "baseline_setup_reader",
    "baseline_setup_grant_connect",
    "baseline_setup_read_only",
    "baseline_setup_schema",
    "baseline_setup_table",
    "baseline_setup_rows",
    "baseline_setup_reset",
  ];
  const queries = [
    "SELECT current_setting('server_version_num'), current_database(), current_user",
    "CREATE ROLE postgres_source_reader LOGIN PASSWORD 'postgres_source_fixture_reader' NOSUPERUSER NOINHERIT NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 1",
    "GRANT CONNECT ON DATABASE tracking TO postgres_source_reader",
    "ALTER ROLE postgres_source_reader SET default_transaction_read_only = on",
    "CREATE SCHEMA postgres_source_fixture",
    "CREATE TABLE postgres_source_fixture.lock_rows (id integer PRIMARY KEY, value integer NOT NULL)",
    "INSERT INTO postgres_source_fixture.lock_rows VALUES (1,0),(2,0)",
    "SELECT pg_catalog.pg_stat_reset()",
  ];
  for (let fault = 0; fault < phases.length; fault++) {
    const primary = new Proxy(
      {},
      {
        get() {
          throw new Error("opaque failure inspected");
        },
      },
    );
    /** @type {string[]} */ const calls = [];
    let ended = 0;
    const owner = fixture(() => ({
      connect: async () => {
        if (fault === 0) throw primary;
      },
      query: async ({ text }) => {
        calls.push(text);
        if (calls.length === fault) throw primary;
        return {
          rows: calls.length === 1 ? [["180004", "tracking", "tracking"]] : [],
        };
      },
      end: async () => {
        ended++;
      },
    }));
    try {
      await owner.act("setup", 1000);
      assert.fail("setup refusal missing");
    } catch (error) {
      assert.equal(error, primary);
    }
    assert.equal(owner.setupPhase(), phases[fault]);
    assert.deepEqual(calls, queries.slice(0, fault));
    await owner.act("close", 1000);
    assert.equal(owner.setupPhase(), null);
    assert.equal(ended, 1);
  }
  /** @type {string[]} */ const calls = [];
  const owner = fixture(() => ({
    connect: async () => {},
    query: async ({ text }) => {
      calls.push(text);
      return {
        rows: calls.length === 1 ? [["180004", "tracking", "tracking"]] : [],
      };
    },
    end: async () => {},
  }));
  await owner.act("setup", 1000);
  assert.deepEqual(calls, queries);
  assert.equal(owner.setupPhase(), null);
  await assert.rejects(owner.act("invalid", 1000));
  assert.equal(owner.setupPhase(), null);
  await owner.act("close", 1000);
});
