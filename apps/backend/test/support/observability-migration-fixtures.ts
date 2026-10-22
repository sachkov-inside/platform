import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";
import type { Migration } from "../../src/infrastructure/postgres/migrate-to-latest.js";

const labels = [
  "main101",
  "main102",
  "main103",
  "main104",
  "root109",
  "legacy113",
  "legacy114",
  "legacy115",
  "legacy116",
] as const;
export type FrozenRegistryName = (typeof labels)[number];
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

/** Historical SQL and order come from committed snapshots, never the candidate registry. */
export function frozenRegistry(
  label: FrozenRegistryName,
): readonly Migration[] {
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
