// @ts-check
import assert from "node:assert/strict";
import { test } from "node:test";
import { decode, fields, SQL, controls } from "./query.mjs";
const now = 1_790_000_000_000_000;
/** @returns {{schema:number,fields:{name:string,oid:number}[],rows:[unknown[]]}} */
function fixture() {
  return {
    schema: 1,
    fields: fields.map(([name, oid]) => ({ name, oid })),
    rows: [
      [
        "180004",
        "on",
        "on",
        "on",
        true,
        true,
        true,
        String(now),
        String(now - 10_000_000),
        String(now - 20_000_000),
        "3",
        "0",
        "2",
      ],
    ],
  };
}
test("ordinary PostgreSQL source admits the complete fixed result without inventing reset identity", () => {
  assert.deepEqual(decode(fixture(), now), {
    sample_us: now,
    postmaster_us: now - 10_000_000,
    stats_reset_us: now - 20_000_000,
    connected_backends: 3,
    waiting_locks: 0,
    deadlocks: 2,
  });
  const raw = fixture();
  raw.rows[0][9] = null;
  assert.throws(() => decode(raw, now), /^Error: identity_unavailable$/);
});
test("all raw columns and values refuse before projection", () => {
  for (let index = 0; index < 13; index += 1) {
    const raw = fixture();
    raw.rows[0][index] = "private-canary";
    assert.throws(() => decode(raw, now), /^Error: malformed$/);
    const wrong = fixture();
    const field = wrong.fields[index];
    assert.ok(field);
    field.oid = 99;
    assert.throws(() => decode(wrong, now), /^Error: malformed$/);
  }
  for (const value of [
    "-1",
    "01",
    "1.5",
    "NaN",
    "Infinity",
    "9007199254740992",
    "1".repeat(4097),
  ]) {
    const raw = fixture();
    raw.rows[0][12] = value;
    assert.throws(() => decode(raw, now), /^Error: malformed$/);
  }
  /** @type {((raw:ReturnType<typeof fixture>)=>unknown)[]} */
  const changes = [
    (raw) => raw.rows.push(raw.rows[0]),
    (raw) => {
      const field = raw.fields[0];
      assert.ok(field);
      raw.fields.push(field);
    },
    (raw) => {
      const field = raw.fields[11];
      assert.ok(field);
      raw.fields[12] = field;
    },
    (raw) => {
      raw.rows[0][8] = String(now + 1);
    },
    (raw) => {
      raw.rows[0][4] = false;
    },
    (raw) => {
      raw.rows[0][10] = "1000001";
    },
  ];
  for (const change of changes) {
    const raw = fixture();
    change(raw);
    assert.throws(() => decode(raw, now), /^Error: malformed$/);
  }
  assert.throws(() => decode(fixture(), now + 2_000_001), /^Error: malformed$/);
});
test("sampler owns exactly one ordinary-role query and fixed read-only controls", () => {
  assert.equal(fields.length, 13);
  assert.equal(controls[0], "BEGIN READ ONLY");
  assert.ok(controls.includes("SET LOCAL stats_fetch_consistency = 'cache'"));
  assert.ok(SQL.includes("a.datid = d.datid AND l.granted = false"));
  assert.ok(!SQL.includes("l.database"));
  assert.ok(
    !/query_text|pg_stat_statements|pg_cancel|pg_terminate|\bGRANT\b|SELECT \*/i.test(
      SQL,
    ),
  );
});
