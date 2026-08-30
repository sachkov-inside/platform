import { createHash } from "node:crypto";

export function seriesOrderVersion(materialIds: readonly string[]): string {
  return createHash("sha256")
    .update(JSON.stringify(materialIds), "utf8")
    .digest("hex");
}
