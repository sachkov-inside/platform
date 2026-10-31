// @ts-check
import { spawnOwned, stopOwned } from "./owned-process.mjs";
import { commandExit } from "./diagnostic-command.mjs";
import { writeFileSync } from "node:fs";

/** This collector runs before pnpm install in the Docker-only CI job.
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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
    /** @type {unknown} */
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return isRecord(value) ? value : null;
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
          health:
            typeof state["health"] === "string" &&
            ["healthy", "unhealthy", "starting", "none"].includes(
              state["health"],
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
