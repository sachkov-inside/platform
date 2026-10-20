// @ts-check
import {
  closeSync,
  lstatSync,
  openSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, resolve } from "node:path";

const milestones = [
  "producer_started",
  "modules_imported",
  "migrated",
  "provider_started",
  "api_started",
  "http_completed",
  "carrier_confirmed",
  "relay_started",
  "delivery_confirmed",
  "sdk_shutdown",
  "module_map_ready",
];

/** Optional private marker. Failure cannot alter the producer's existing business result.
 * @param {"tracking"|"waitlist"} scope
 * @returns {(milestone:string)=>void}
 */
export function createApiProgress(scope) {
  const path = process.env.INSIDE_PRODUCER_PHASE_PATH;
  const source = process.env.INSIDE_PRODUCER_PHASE_SOURCE;
  if (
    path === undefined ||
    source === undefined ||
    process.env.INSIDE_PRODUCER_PHASE_SCOPE !== scope ||
    !/^[0-9a-f]{40}$/u.test(source)
  )
    return () => {};
  let previous = -1;
  return (milestone) => {
    const position = milestones.indexOf(milestone);
    if (
      position <= previous ||
      position < 0 ||
      (scope === "tracking" && milestone === "relay_started")
    )
      return;
    const temporary = path + ".new";
    let descriptor;
    let created = false;
    try {
      const directory = dirname(path);
      const info = lstatSync(directory);
      if (
        basename(path) !== "phase.json" ||
        resolve(path) !== path ||
        realpathSync(directory) !== directory ||
        !info.isDirectory() ||
        info.uid !== process.getuid?.() ||
        (info.mode & 0o777) !== 0o700
      )
        return;
      const raw =
        JSON.stringify({
          schema: 1,
          scope,
          source,
          state: "observed",
          milestone,
        }) + "\n";
      if (Buffer.byteLength(raw) > 512) return;
      descriptor = openSync(temporary, "wx", 0o600);
      created = true;
      writeFileSync(descriptor, raw);
      closeSync(descriptor);
      descriptor = undefined;
      renameSync(temporary, path);
      created = false;
      previous = position;
    } catch {
      // Preserve the last completely committed milestone and the original producer outcome.
    } finally {
      if (descriptor !== undefined) {
        try {
          closeSync(descriptor);
        } catch {
          /* Marker failure never replaces a business failure. */
        }
      }
      if (created) {
        try {
          unlinkSync(temporary);
        } catch {
          /* Parent owns eventual private-directory removal. */
        }
      }
    }
  };
}
