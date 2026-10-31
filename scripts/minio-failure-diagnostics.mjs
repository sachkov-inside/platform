// @ts-check
import { spawnOwned, stopOwned } from "./owned-process.mjs";
import { commandExit } from "./diagnostic-command.mjs";
import { z } from "zod";
import { writeFileSync } from "node:fs";

/** Never persist Docker errors, health command output, labels, environment or server logs.
 * @param {string[]} args
 * @returns {Promise<Record<string, unknown> | null>}
 */
async function observation(args) {
  const child = spawnOwned("docker", args, {
    stdio: ["ignore", "pipe", "ignore"],
  });
  const exit = commandExit(child);
  let rejected = false;
  let bytes = 0;
  /** @type {Buffer[]} */
  const chunks = [];
  child.stdout?.on("data", (/** @type {Buffer} */ chunk) => {
    bytes += chunk.length;
    if (bytes > 4096) {
      rejected = true;
      void stopOwned(child, 100);
    } else if (!rejected) chunks.push(chunk);
  });
  // deterministic-test-allow duration-wait: diagnostic failure budget; supervisor exit proves command-tree cleanup.
  const deadline = setTimeout(() => {
    rejected = true;
    void stopOwned(child, 100);
  }, 2000);
  try {
    const status = await exit;
    if (rejected || status !== 0) return null;
    return z
      .record(z.string(), z.unknown())
      .parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  } catch {
    return null;
  } finally {
    clearTimeout(deadline);
    await stopOwned(child, 100);
  }
}
const container = process.argv[2];
const destination = process.argv[3];
if (!container || !destination)
  throw new Error("Container and destination are required");
const state = await observation([
  "inspect",
  "--format",
  '{"running":{{json .State.Running}},"restarts":{{json .RestartCount}},"health":{{if .State.Health}}{{json .State.Health.Status}}{{else}}"none"{{end}}}',
  container,
]);
const resources = await observation([
  "stats",
  "--no-stream",
  "--format",
  "{{json .}}",
  container,
]);
/** @param {unknown} value */
function quantity(value) {
  return typeof value === "string" &&
    value.length <= 64 &&
    /^[\d. %/kMGTPEiB]+$/u.test(value)
    ? value
    : null;
}
writeFileSync(
  destination,
  JSON.stringify({
    capturedAt: new Date().toISOString(),
    state: state
      ? {
          running:
            typeof state["running"] === "boolean" ? state["running"] : null,
          restarts: Number.isSafeInteger(state["restarts"])
            ? state["restarts"]
            : null,
          health: ["healthy", "unhealthy", "starting", "none"].includes(
            String(state["health"]),
          )
            ? state["health"]
            : null,
        }
      : null,
    resources: resources
      ? {
          cpu: quantity(resources["CPUPerc"]),
          memory: quantity(resources["MemUsage"]),
          network: quantity(resources["NetIO"]),
          block: quantity(resources["BlockIO"]),
          processes: quantity(resources["PIDs"]),
        }
      : null,
  }) + "\n",
);
