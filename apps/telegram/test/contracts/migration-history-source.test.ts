import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

import { parseSync, Visitor, type BlockStatement } from "oxc-parser";
import { expect, it } from "vitest";
import { z } from "zod";

import { runOwnedCommandSync } from "../support/owned-command.js";
import {
  currentMigrationNames,
  legacyMigrationNames,
} from "../support/migration-history-ledgers.js";

const historyTitle =
  "preserves existing data and supports down/latest after %s deployment";

function historyCallback() {
  const source = readFileSync(
    "test/integration/migration-history.integration.test.ts",
    "utf8",
  );
  const parsed = parseSync("migration-history.integration.test.ts", source);
  expect(parsed.errors).toEqual([]);
  let block: BlockStatement | undefined;
  new Visitor({
    CallExpression(node) {
      const [title, body] = node.arguments;
      if (
        title?.type === "Literal" &&
        title.value === historyTitle &&
        body?.type === "ArrowFunctionExpression" &&
        body.body.type === "BlockStatement"
      )
        block = body.body;
    },
  }).visit(parsed.program);
  if (!block) throw new Error("Historical deployment callback is missing");
  return { source, statements: block.body };
}

function registeredMigrations() {
  const result = runOwnedCommandSync(
    process.execPath,
    ["scripts/release-contract.mjs", "migration-names"],
    { encoding: "utf8" },
  );
  expect(result.status, result.stderr).toBe(0);
  return z.array(z.string()).parse(JSON.parse(result.stdout));
}

// Replay the actual consumer assertions only, with supplied SQL result payloads.
// This does not run migrations, PostgreSQL, the histories or data-preservation callbacks.
function replayFinalLedgerAssertions(names: readonly string[]) {
  const { source, statements } = historyCallback();
  const text = (statement: { start: number; end: number }) =>
    source.slice(statement.start, statement.end);
  const lastLatest = statements.findLastIndex(
    (statement) => text(statement) === "await migrateToLatest(database);",
  );
  const assertions = statements
    .slice(lastLatest + 1)
    .filter(
      (statement) =>
        statement.type === "ExpressionStatement" &&
        (text(statement).startsWith("expect(ledger.") ||
          text(statement).startsWith("expect(applied)")),
    );
  if (lastLatest < 0 || assertions.length === 0)
    throw new Error("Final latest ledger assertions are missing");
  runInNewContext(
    assertions.map(text).join("\n"),
    {
      expect,
      ledger: { rows: [{ count: String(names.length) }] },
      applied: [...names],
      currentMigrationNames,
      legacyMigrationNames,
    },
    { timeout: 1_000 },
  );
}

it("replays the actual final history assertions against the current031 registry", () => {
  const names = registeredMigrations();
  expect(names).toEqual(currentMigrationNames);
  replayFinalLedgerAssertions(names);
});

it.each(["foreign-key", "duplicate-key", "missing031", "extra-key"] as const)(
  "the actual final history assertions reject %s in the applied ledger",
  (control) => {
    const names =
      control === "foreign-key"
        ? currentMigrationNames.map((name) =>
            name === "031-mini-app-sign-in" ? "031-unexpected" : name,
          )
        : control === "duplicate-key"
          ? currentMigrationNames.map((name) =>
              name === "030-invitation-redemptions"
                ? "031-mini-app-sign-in"
                : name,
            )
          : control === "missing031"
            ? [...legacyMigrationNames]
            : [...currentMigrationNames, "032-unexpected"];
    expect(() => replayFinalLedgerAssertions(names)).toThrow();
  },
);
