import { createHash } from "node:crypto";

export function seriesOrderVersion(materialIds: readonly string[], stepGroups: Readonly<Record<string, string>> = {}): string {
  return createHash("sha256")
    .update(JSON.stringify(materialIds.map((id) => [id, stepGroups[id] ?? null])), "utf8")
    .digest("hex");
}
