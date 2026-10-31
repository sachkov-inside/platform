import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { platformMigrations } from "../../src/migrations/index.js";
import {
  assertAppliedMigrations,
  migrationChecksum,
  type Migration,
} from "../../src/infrastructure/postgres/migrate-to-latest.js";
import { frozenRegistry } from "../support/observability-migration-fixtures.js";

const ledger = (rows: readonly Migration[]) =>
  rows.map((row, index) => ({
    name: row.name,
    checksum: migrationChecksum(row.statement),
    position: index + 1,
  }));

it("retains exact historical main prefixes and the independently frozen current-main 116-entry prefix", () => {
  for (const label of [
    "main101",
    "main102",
    "main103",
    "main104",
    "main114",
    "main115",
    "main116",
  ] as const) {
    const main = frozenRegistry(label);
    expect(platformMigrations.slice(0, main.length)).toEqual(main);
    expect(() =>
      assertAppliedMigrations(ledger(main), platformMigrations),
    ).not.toThrow();
  }
  expect(platformMigrations).toHaveLength(130);
  expect(new Set(platformMigrations.map(({ name }) => name)).size).toBe(130);
  expect(platformMigrations.slice(116).map(({ name }) => name)).toEqual([
    "0114_funnel_diagnostic_candidates",
    "0115_billing_funnel_diagnostic_sources",
    "0116_reading_funnel_diagnostic_sources",
    "0117_telegram_funnel_diagnostic_identities",
    "0118_funnel_diagnostic_current_products",
    "0119_learning_activity_provenance",
    "0120_bookmark_activity_provenance",
    "0121_submission_activity_period",
    "0122_materials_notification_trace_context",
    "0123_notifications_notification_trace_context",
    "0124_notifications_email_trace_context",
    "0125_communications_tracking_trace_context",
    "0126_waitlist_trace_context",
    "0127_queue_work_observation",
  ]);
});

it("keeps independently frozen old histories and rejects each divergent ledger without mutating it", () => {
  for (const [label, digest, position] of [
    [
      "root109",
      "9ec856bf4e1f555c648028ed80fd2d8715835376746b8eb3b42166b23a5b3872",
      102,
    ],
    [
      "legacy113",
      "e3176346cb0b8c9d7509554dc5f04fc6f614489051faeaed750006c49d2c38e8",
      103,
    ],
    [
      "legacy114",
      "a254d3ce7962494f014693a49112283c0117891c9ff505f3b018afbfe714f2ae",
      103,
    ],
    [
      "legacy115",
      "940c2af569de197c2b1eb1b16321bb06bb5dac825a02b84c1b8dfdef307d18e4",
      103,
    ],
  ] as const) {
    const old = frozenRegistry(label);
    expect(createHash("sha256").update(JSON.stringify(old)).digest("hex")).toBe(
      digest,
    );
    const applied = ledger(old);
    const before = structuredClone(applied);
    expect(() => assertAppliedMigrations(applied, platformMigrations)).toThrow(
      `not an exact registry prefix at position ${String(position)}`,
    );
    expect(applied).toEqual(before);
    expect(() => assertAppliedMigrations(applied, old)).not.toThrow();
  }
});

it("rejects independently frozen legacy116 ledger at position 104 without mutation", () => {
  const old = frozenRegistry("legacy116");
  const applied = ledger(old);
  const before = structuredClone(applied);
  expect(() => assertAppliedMigrations(applied, platformMigrations)).toThrow(
    "not an exact registry prefix at position 104",
  );
  expect(applied).toEqual(before);
  expect(() => assertAppliedMigrations(applied, old)).not.toThrow();
});
