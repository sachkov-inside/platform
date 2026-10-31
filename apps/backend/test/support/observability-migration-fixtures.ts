import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";
import type { Migration } from "../../src/infrastructure/postgres/migrate-to-latest.js";

const labels = [
  "main101",
  "main102",
  "main103",
  "main104",
  "main114",
  "main115",
  "root109",
  "legacy113",
  "legacy114",
  "legacy115",
  "legacy116",
] as const;
export type FrozenRegistryName = (typeof labels)[number] | "main116";
const fixture = z
  .strictObject({
    schema: z.literal(1),
    entries: z.record(
      z.string(),
      z.strictObject({ name: z.string().min(1), statement: z.string() }),
    ),
    registries: z.record(
      z.enum(labels),
      z.strictObject({
        commit: z.string().length(40),
        digest: z.string().length(64),
        entries: z.array(z.string()),
      }),
    ),
  })
  .parse(
    JSON.parse(
      readFileSync(
        new URL(
          "../fixtures/observability-migrations/registries.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ),
  );

const trustedA6 = z
  .strictObject({
    schema: z.literal(1),
    commit: z.literal("a6e5d4da197e5f1f365a16a6b30e2c55ba8599e4"),
    digest: z.string().length(64),
    entries: z.array(
      z.strictObject({ name: z.string().min(1), statement: z.string() }),
    ),
  })
  .parse(
    JSON.parse(
      readFileSync(
        new URL(
          "../fixtures/observability-migrations/main116-a6.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ),
  );

/** Historical SQL and order come from committed snapshots, never the candidate registry. */
export function frozenRegistry(
  label: FrozenRegistryName,
): readonly Migration[] {
  if (label === "main116") {
    const rows = trustedA6.entries.map((entry) => ({ ...entry }));
    if (
      createHash("sha256").update(JSON.stringify(rows)).digest("hex") !==
      trustedA6.digest
    ) {
      throw new Error("Frozen trusted-a6 migration fixture digest mismatch");
    }
    return rows;
  }
  const registry = fixture.registries[label];
  const rows = registry.entries.map((id) => {
    const entry = fixture.entries[id];
    if (entry === undefined)
      throw new Error("Frozen migration fixture is incomplete");
    return { ...entry };
  });
  if (
    createHash("sha256").update(JSON.stringify(rows)).digest("hex") !==
    registry.digest
  ) {
    throw new Error("Frozen migration fixture digest mismatch");
  }
  return rows;
}
