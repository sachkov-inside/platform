import { expect, it } from "vitest";
import { platformMigrations } from "../../src/migrations/index.js";
import {
  assertAppliedMigrations,
  migrationChecksum,
} from "../../src/infrastructure/postgres/migrate-to-latest.js";

// Frozen index ledger after the current Products ownership adaptation. Main prefix SQL stays unchanged.
const indexLedger = [
  {
    name: "0114_funnel_diagnostic_candidates",
    checksum:
      "119ff7182376b2bcf0e888a0e443b9b84aa5a2135a42d2f94c901f91904e6497",
  },
  {
    name: "0115_billing_funnel_diagnostic_sources",
    checksum:
      "b9a8cc061a6cb6d79a9818c1beddb0736de28ee2a35e4d53ad877cc4b1a844f1",
  },
  {
    name: "0116_reading_funnel_diagnostic_sources",
    checksum:
      "a8cbf52fe672bc0721bc78abcad353420a402f82e2ed44e575816c03d9579e9d",
  },
  {
    name: "0117_telegram_funnel_diagnostic_identities",
    checksum:
      "e79f2a06773f9f38af4d2715c0881bf017df149a4152137803f5fb387b9bbb8a",
  },
  {
    name: "0118_funnel_diagnostic_current_products",
    checksum:
      "565cd4f27b24b6213ed3100d44b9785fd0adca0d895cbdd1f6c91f69398de635",
  },
];
const beforeIndexes = platformMigrations.findIndex(
  (migration) => migration.name === "0114_funnel_diagnostic_candidates",
);
const applied = [
  ...platformMigrations.slice(0, beforeIndexes).map((migration, index) => ({
    name: migration.name,
    position: index + 1,
    checksum: migrationChecksum(migration.statement),
  })),
  ...indexLedger.map((row, index) => ({
    ...row,
    position: beforeIndexes + index + 1,
  })),
];

it("refuses the old application registry after diagnostic index migrations", () => {
  expect(beforeIndexes).toBeGreaterThan(0);
  expect(() =>
    assertAppliedMigrations(
      applied,
      platformMigrations.slice(0, beforeIndexes),
    ),
  ).toThrow("Migration ledger is not an exact registry prefix");
});

it("accepts the rollback build retaining the full registry and unchanged migration files", () => {
  // Reverting diagnostic implementation does not revert these registry entries or SQL files.
  const rollbackBuildRegistry = [
    ...platformMigrations.slice(0, beforeIndexes),
    ...platformMigrations.slice(beforeIndexes),
  ];
  expect(
    rollbackBuildRegistry.at(beforeIndexes + indexLedger.length - 1)?.name,
  ).toBe("0118_funnel_diagnostic_current_products");
  expect(() =>
    assertAppliedMigrations(applied, rollbackBuildRegistry),
  ).not.toThrow();
});

it("refuses a rollback build that edits retained migration SQL instead of preserving its checksum", () => {
  const rollbackBuildRegistry = platformMigrations.map((migration, index) =>
    index === beforeIndexes
      ? { ...migration, statement: `${migration.statement}\n-- changed` }
      : migration,
  );
  expect(() => assertAppliedMigrations(applied, rollbackBuildRegistry)).toThrow(
    "Migration checksum mismatch: 0114_funnel_diagnostic_candidates",
  );
});
