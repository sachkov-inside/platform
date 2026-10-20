import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import type { PathLike } from "node:fs";
import {
  productionRuntimeIdentitySchema,
  type ProductionRuntimeIdentity,
} from "@inside/runtime-identity";

/** Missing or damaged image metadata disables telemetry, never application startup. */
export function loadTelegramImageIdentity(
  path: PathLike = new URL("../../release-identity.json", import.meta.url),
): ProductionRuntimeIdentity | undefined {
  try {
    const descriptor = openSync(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const file = fstatSync(descriptor);
      if (!file.isFile() || file.size > 512) return undefined;
      // One extra byte also rejects a file that grows after the size check.
      const bytes = Buffer.alloc(513);
      const length = readSync(descriptor, bytes, 0, bytes.length, 0);
      if (length > 512) return undefined;
      const result = productionRuntimeIdentitySchema.safeParse(
        JSON.parse(bytes.subarray(0, length).toString("utf8")),
      );
      return result.success ? result.data : undefined;
    } finally {
      closeSync(descriptor);
    }
  } catch {
    return undefined;
  }
}
