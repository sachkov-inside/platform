// @ts-check
import assert from "node:assert/strict";
import { test } from "node:test";
import { configuration, acquire, isSettledFailure } from "./sample.mjs";
import { fields, SQL, decode } from "./query.mjs";
// deterministic-test-allow unit-io: fixed public Client lifecycle double; no network, timers or PG.
test("a valid source packet is unavailable until public client end settles", async () => {
  /** @type {()=>void} */ let release = () => {
    throw new Error("not acquired");
  };
  const closed = new Promise((resolve) => {
    release = () => resolve(undefined);
  });
  /** @type {string[]} */ const calls = [];
  let exported = false;
  const client = {
    connect: async () => {},
    /** @param {import('./sample.mjs').Statement} statement */
    query: async ({ text }) => {
      calls.push(text);
      return {
        command: "SELECT",
        rowCount: 1,
        fields: fields.map(([name, dataTypeID]) => ({
          name,
          dataTypeID,
          format: "text",
        })),
        rows: [
          [
            "180004",
            "on",
            "on",
            "on",
            true,
            true,
            true,
            "1790000000000000",
            "1789999990000000",
            "1789999980000000",
            "3",
            "0",
            "0",
          ],
        ],
      };
    },
    end: () => closed,
  };
  const pending = acquire(
    client,
    () => 4000,
    () => 1790000000000000,
  ).then((value) => {
    exported = true;
    return value;
  });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(exported, false);
  release();
  const wire = await pending;
  /** @type {unknown} */ const raw = JSON.parse(wire);
  assert.equal(decode(raw, 1790000000000000).connected_backends, 3);
  assert.equal(calls.at(-1), "ROLLBACK");
  assert.ok(calls.includes(SQL));
});
test("connection and end failures never emit a healthy packet", async () => {
  for (const stage of ["connect", "query", "end"]) {
    /** @type {string[]} */ const calls = [];
    const primary = new Error("controlled private failure");
    const client = {
      connect: async () => {
        calls.push("connect");
        if (stage === "connect") throw primary;
      },
      query: async () => {
        calls.push("query");
        if (stage === "query") throw primary;
      },
      end: async () => {
        calls.push("end");
        if (stage === "end") throw primary;
      },
    };
    await assert.rejects(
      acquire(
        client,
        () => 4000,
        () => 1790000000000000,
      ),
    );
    assert.equal(calls.at(-1), "end");
  }
  const config = configuration("synthetic", 4000);
  assert.equal(config.user, "postgres_source_reader");
  assert.equal(config.connectionTimeoutMillis, 2000);
  assert.equal(config.ssl, false);
  assert.equal(config.host, "127.0.0.1");
  assert.throws(() => configuration("", 4000));
});
test("rollback and end cleanup preserve the first private failure object", async () => {
  const primary = new Error("controlled query failure"),
    secondary = new Error("controlled cleanup failure");
  const client = {
    connect: async () => {},
    /** @param {import('./sample.mjs').Statement} statement */
    query: async ({ text }) => {
      throw text === "ROLLBACK" ? secondary : primary;
    },
    end: async () => {
      throw secondary;
    },
  };
  await assert.rejects(
    acquire(
      client,
      () => 4000,
      () => 1790000000000000,
    ),
    (error) => error === primary,
  );
});

test("failed query classification requires actual end settlement and remaining work", async () => {
  const primary = new Error("controlled query refusal");
  for (const state of ["closed", "end_failed", "expired"]) {
    let ended = false;
    const client = {
      connect: async () => {},
      query: async () => {
        throw primary;
      },
      end: async () => {
        ended = true;
        if (state === "end_failed") throw new Error("controlled close failure");
      },
    };
    await assert.rejects(
      acquire(
        client,
        () => (state === "expired" && ended ? 0 : 4000),
        () => 1790000000000000,
      ),
      (error) => error === primary,
    );
    assert.equal(isSettledFailure(primary), state === "closed");
  }
});
