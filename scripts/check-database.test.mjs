// @ts-check
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
  /** @type {string[]} */
  const statements = [];
  let exists = "";
  /** @type {import("./check-database.mjs").RunCommand} */
  const run = (_command, args) => {
    const sql = args.at(-1) ?? "";
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
  /** @type {(string | undefined)[]} */
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

test("check database commands run in the Compose project named by COMPOSE_PROJECT_NAME", () => {
  for (const [environment, project] of /** @type {const} */ ([
    [{ COMPOSE_PROJECT_NAME: "inside-platform-x" }, "inside-platform-x"],
    [{}, "inside-platform"],
    [{ COMPOSE_PROJECT_NAME: " " }, "inside-platform"],
  ])) {
    for (const command of [resetCheckDatabase, ensureCheckDatabase]) {
      /** @type {string[]} */
      const projects = [];
      command({
        environment,
        run: (_command, args) => {
          projects.push(args[args.indexOf("--project-name") + 1] ?? "");
          return "";
        },
      });
      assert.ok(projects.length > 0);
      assert.deepEqual(new Set(projects), new Set([project]));
    }
  }
});
