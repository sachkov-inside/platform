import assert from "node:assert/strict";
import { test } from "node:test";

import {
  checkDatabaseName,
  checkDatabaseUrl,
  ensureCheckDatabase,
  resetCheckDatabase,
} from "./check-database.mjs";

test("checks use their own database beside the stand database", () => {
  assert.equal(
    checkDatabaseUrl(),
    "postgresql://inside:inside@127.0.0.1:5432/inside_checks",
  );
  assert.notEqual(checkDatabaseName, "inside");
});

test("the check database is created once and never replaces the stand database", () => {
  const statements = [];
  let exists = "";
  const run = (_command, args) => {
    const sql = args.at(-1);
    statements.push(sql);
    if (sql.startsWith("create")) exists = "1";
    return sql.startsWith("select") ? exists : "";
  };
  ensureCheckDatabase({ run });
  ensureCheckDatabase({ run });
  assert.deepEqual(
    statements.filter((sql) => sql.startsWith("create")),
    ["create database inside_checks"],
  );
  assert.ok(
    statements.every(
      (sql) => !/drop|inside\b(?!_)/iu.test(sql.replace("-d inside", "")),
    ),
  );
});

test("a reset recreates only the check database", () => {
  const statements = [];
  resetCheckDatabase({
    run: (_command, args) => {
      statements.push(args.at(-1));
      return "";
    },
  });
  assert.deepEqual(statements, [
    "drop database if exists inside_checks with (force)",
    "create database inside_checks",
  ]);
});
