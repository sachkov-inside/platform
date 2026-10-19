import { expect, it } from "vitest";
import { platformMigrations } from "../../src/migrations/index.js";
import {
  assertAppliedMigrations,
  migrationChecksum,
} from "../../src/infrastructure/postgres/migrate-to-latest.js";

// Index ledger checksums frozen from reviewed bd524e53. Prefix entries predate this change.
const indexLedger = [
  {
    name: "0100_funnel_diagnostic_candidates",
    checksum:
      "119ff7182376b2bcf0e888a0e443b9b84aa5a2135a42d2f94c901f91904e6497",
  },
  {
    name: "0101_billing_funnel_diagnostic_sources",
    checksum:
      "86efa84bf17330ada4b1313c56e22a3ec1f5164a02c76d712a544a67b422577f",
  },
  {
    name: "0102_reading_funnel_diagnostic_sources",
    checksum:
      "a8cbf52fe672bc0721bc78abcad353420a402f82e2ed44e575816c03d9579e9d",
  },
  {
    name: "0103_telegram_funnel_diagnostic_identities",
    checksum:
      "e79f2a06773f9f38af4d2715c0881bf017df149a4152137803f5fb387b9bbb8a",
  },
  {
    name: "0104_funnel_diagnostic_current_products",
    checksum:
      "ac436212ef4cc8f078a90322d2b72aaa6b073ab502fe60cf25920c7548700979",
  },
];
const beforeIndexes = platformMigrations.findIndex(
  (migration) => migration.name === "0100_funnel_diagnostic_candidates",
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
  ).toBe("0104_funnel_diagnostic_current_products");
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
    "Migration checksum mismatch: 0100_funnel_diagnostic_candidates",
  );
});
