// @ts-check
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const rawInventory = readFileSync(
  new URL("./source-tests.json", import.meta.url),
);
if (rawInventory.length > 32768)
  throw new Error("closed Resource source inventory refused");
/** @type {unknown} */
const inventory = JSON.parse(rawInventory.toString("utf8"));
if (!Array.isArray(inventory) || inventory.length > 256)
  throw new Error("closed Resource source inventory refused");
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
    throw new Error("closed Resource source inventory refused");
  ids.push(value);
}
export const sourceIds = Object.freeze(ids);

/** @param {unknown} stderr */
export function sourceProgress(stderr) {
  if (typeof stderr !== "string" || Buffer.byteLength(stderr) > 1_048_576)
    return null;
  /** @type {string | null} */
  let active = null;
  /** @type {string | null} */
  let lastStarted = null;
  /** @type {string | null} */
  let lastCompleted = null;
  let completedCount = 0;
  let markerBytes = 0;
  let offset = 0;
  while (offset < stderr.length) {
    const end = stderr.indexOf("\n", offset);
    const line = stderr.slice(offset, end < 0 ? stderr.length : end);
    offset = end < 0 ? stderr.length : end + 1;
    if (!line.includes("RESOURCE_SOURCE")) continue;
    markerBytes += Buffer.byteLength(line) + 1;
    if (end < 0 || markerBytes > 32768) return null;
    if (active === null) {
      const expected = sourceIds[completedCount];
      if (
        expected === undefined ||
        line !== `RESOURCE_SOURCE_V1 start ${expected}`
      )
        return null;
      active = expected;
      lastStarted = expected;
    } else {
      if (line !== `RESOURCE_SOURCE_V1 completed ${active}`) return null;
      lastCompleted = active;
      active = null;
      completedCount += 1;
    }
  }
  return lastStarted === null
    ? null
    : { lastStarted, lastCompleted, completedCount };
}

/** @param {Awaited<ReturnType<typeof import("../observability-umami/process-owner.mjs").runOwnedProcess>>} result */
export function assertResourceContracts(result) {
  const progress =
    result.reason === "output_limit" ? null : sourceProgress(result.stderr);
  const message =
    progress === null
      ? "Resource source progress: unknown"
      : `Resource source progress: lastStarted=${progress.lastStarted}; lastCompleted=${progress.lastCompleted ?? "none"}; completedCount=${progress.completedCount}`;
  assert.equal(result.reason, "exit", message);
  assert.equal(result.code, 0, message);
}
