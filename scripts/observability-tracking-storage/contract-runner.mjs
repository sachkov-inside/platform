// @ts-check
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runOwnedProcess } from "../observability-umami/process-owner.mjs";

const rawInventory = readFileSync(
  new URL("./source-tests.json", import.meta.url),
);
if (rawInventory.length > 32768)
  throw new Error("closed tracking source inventory refused");
/** @type {unknown} */
const inventory = JSON.parse(rawInventory.toString("utf8"));
if (!Array.isArray(inventory) || inventory.length > 256)
  throw new Error("closed tracking source inventory refused");
/** @type {string[]} */
const ids = [];
for (const value of inventory) {
  const previous = ids.at(-1);
  if (
    typeof value !== "string" ||
    value.length > 192 ||
    !/^test_[a-z0-9_]+\.[A-Za-z][A-Za-z0-9]*\.test_[a-z0-9_]+$/u.test(value) ||
    (previous !== undefined && value <= previous)
  )
    throw new Error("closed tracking source inventory refused");
  ids.push(value);
}
export const sourceIds = Object.freeze(ids);
export const sourceGroups = Object.freeze({
  contracts: Object.freeze(
    ids.filter((id) => !id.startsWith("test_outer_owner.")),
  ),
  "process-owner": Object.freeze(
    ids.filter((id) => id.startsWith("test_outer_owner.")),
  ),
});

/**
 * @param {Awaited<ReturnType<typeof runOwnedProcess>>} result
 * @param {"contracts" | "process-owner"} group
 */
export function assertTrackingContracts(result, group) {
  const message = `tracking ${group} contracts did not complete`;
  assert.equal(result.reason, "exit", message);
  assert.equal(result.code, 0, message);
  // A zero exit alone cannot turn an omitted or incomplete selected suite into success.
  const markers = result.stderr
    .split("\n")
    .filter((line) => line.includes("TRACKING_CONTRACTS"));
  assert.ok(
    result.stderr.endsWith("\n") &&
      markers.length === 1 &&
      markers[0] ===
        `TRACKING_CONTRACTS_V1 completed ${group} ${sourceGroups[group].length}`,
    message,
  );
}

/** @param {string[]} args @param {{timeoutMs?:number}} [options] */
export async function runTrackingContracts(args, options = {}) {
  return runOwnedProcess(
    "python3",
    [
      "-B",
      "scripts/observability-tracking-storage/contract_runner.py",
      ...args,
    ],
    {
      timeoutMs: options.timeoutMs ?? 15000,
      // Python capture owns native-child reap, including its two-second TERM grace.
      terminateGraceMs: 2500,
      cleanupBudgetMs: 5000,
    },
  );
}

// Private native regression CLI; the ordinary test wrapper calls the same owner.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await runTrackingContracts(process.argv.slice(2), {
    timeoutMs: process.argv[3] === "timeout" ? 700 : 15000,
  });
  process.exitCode = result.code === 0 && result.reason === "exit" ? 0 : 1;
}
