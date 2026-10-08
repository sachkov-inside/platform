import {
  spawnSync,
  type SpawnSyncOptionsWithStringEncoding,
} from "node:child_process";
import { fileURLToPath } from "node:url";

const owner = fileURLToPath(
  new URL("../../../../scripts/owned-node.mjs", import.meta.url),
);

/** The deadline requests supervised cleanup; synchronous return follows the owner's exit. */
export function runOwnedCommandSync(
  command: string,
  args: readonly string[],
  options: SpawnSyncOptionsWithStringEncoding,
) {
  return spawnSync(process.execPath, [owner, "--command", command, ...args], {
    ...options,
    timeout: options.timeout ?? 30_000,
    // The owner awaits its supervisor, which forces KILL after the TERM grace period.
    killSignal: "SIGTERM",
  });
}
