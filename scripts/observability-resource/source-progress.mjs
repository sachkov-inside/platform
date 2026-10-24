// @ts-check
import assert from "node:assert/strict";
import { types } from "node:util";
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

const timingUnknown = "Resource timing: unknown";
const timingModes = Object.freeze([
  "success",
  "failure",
  "timeout",
  "sigterm",
  "sigkill",
  "descendant",
]);
const timingSequence = Object.freeze([
  ["begin", "runner"],
  ["begin", "item84"],
  ...timingModes.flatMap((mode) => [
    ["begin", mode],
    ["end", mode],
  ]),
  ["end", "item84"],
  ["end", "runner"],
]);
const timingFields = Object.freeze([
  "before84",
  ...timingModes,
  "item84",
  "runner",
]);

/** @param {unknown} value @param {string} key @returns {unknown} */
function ownData(value, key) {
  if (typeof value !== "object" || value === null || types.isProxy(value))
    return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && Object.hasOwn(descriptor, "value")
    ? descriptor.value
    : undefined;
}

/** @param {string} stderr */
function parseTiming(stderr) {
  if (stderr.includes("RESOURCE_SOURCE") && sourceProgress(stderr) === null)
    return timingUnknown;
  let completed = 0;
  let active = false;
  let next = 0;
  let last = 0;
  let bytes = 0;
  let count = 0;
  let partial = false;
  /** @type {Map<string, number>} */
  const begins = new Map();
  /** @type {Map<string, number>} */
  const durations = new Map();
  let offset = 0;
  while (offset < stderr.length) {
    const end = stderr.indexOf("\n", offset);
    const line = stderr.slice(offset, end < 0 ? stderr.length : end);
    offset = end < 0 ? stderr.length : end + 1;
    if (line.startsWith("RESOURCE_SOURCE_V1 start ")) active = true;
    else if (line.startsWith("RESOURCE_SOURCE_V1 completed ")) {
      active = false;
      completed += 1;
    }
    if (!line.includes("RESOURCE_TIMING")) continue;
    bytes += Buffer.byteLength(line) + 1;
    count += 1;
    if (end < 0 || bytes > 2048 || count > 17) return timingUnknown;
    const match =
      /^RESOURCE_TIMING_V1 (begin|end) (runner|item84|success|failure|timeout|sigterm|sigkill|descendant) (0|[1-9][0-9]{0,10})$/u.exec(
        line,
      );
    if (match === null) return timingUnknown;
    const event = match[1],
      slot = match[2],
      elapsed = Number(match[3]);
    if (
      event === undefined ||
      slot === undefined ||
      elapsed > 60_000_000_000 ||
      elapsed < last
    )
      return timingUnknown;
    const earlyEnd =
      next >= 2 && next < 14 && event === "end" && slot === "item84";
    if (earlyEnd) {
      partial = true;
      next = 14;
    }
    const expected = timingSequence[next];
    if (expected === undefined || event !== expected[0] || slot !== expected[1])
      return timingUnknown;
    if (next === 0) {
      if (completed !== 0 || active || elapsed !== 0) return timingUnknown;
    } else if (next === 1 || (next >= 2 && next <= 13)) {
      if (completed !== 83 || !active) return timingUnknown;
    } else if (next === 14) {
      if (completed !== 84 || active) return timingUnknown;
    } else if (completed !== sourceIds.length || active) return timingUnknown;
    if (event === "begin") {
      begins.set(slot, elapsed);
      if (slot === "item84") durations.set("before84", elapsed);
    } else {
      const begin = begins.get(slot);
      if (begin === undefined) return timingUnknown;
      durations.set(slot, elapsed - begin);
    }
    next += 1;
    last = elapsed;
  }
  if (next === 0) return timingUnknown;
  const state =
    next === timingSequence.length && !partial ? "complete" : "partial";
  return `Resource timing: state=${state}; ${timingFields.map((field) => `${field}_ns=${durations.get(field) ?? "unknown"}`).join("; ")}`;
}

/** The new projection never invokes unknown getters or publishes captured output. @param {unknown} result */
export function resourceTimingSummary(result) {
  try {
    const reason = ownData(result, "reason");
    if (
      reason === "output_limit" ||
      (reason !== "exit" && reason !== "timeout" && reason !== "interrupted")
    )
      return timingUnknown;
    const stderr = ownData(result, "stderr");
    if (typeof stderr !== "string" || Buffer.byteLength(stderr) > 1_048_576)
      return timingUnknown;
    return parseTiming(stderr);
  } catch {
    return timingUnknown;
  }
}

/** @param {unknown} summary */
function timingSuffix(summary) {
  if (summary === timingUnknown) return summary;
  if (typeof summary !== "string" || summary.length > 512) return timingUnknown;
  const parts = summary.split("; ");
  if (
    parts.length !== timingFields.length + 1 ||
    !/^Resource timing: state=(complete|partial)$/u.test(parts[0] ?? "")
  )
    return timingUnknown;
  for (const [index, field] of timingFields.entries()) {
    const part = parts[index + 1];
    if (part === undefined || !part.startsWith(`${field}_ns=`))
      return timingUnknown;
    const value = part.slice(field.length + 4);
    if (
      value !== "unknown" &&
      (!/^(0|[1-9][0-9]{0,10})$/u.test(value) || Number(value) > 60_000_000_000)
    )
      return timingUnknown;
  }
  return summary;
}

/** @param {Awaited<ReturnType<typeof import("../observability-umami/process-owner.mjs").runOwnedProcess>>} result @param {unknown} [summary] */
export function assertResourceContracts(result, summary = undefined) {
  const progress =
    result.reason === "output_limit" ? null : sourceProgress(result.stderr);
  const progressMessage =
    progress === null
      ? "Resource source progress: unknown"
      : `Resource source progress: lastStarted=${progress.lastStarted}; lastCompleted=${progress.lastCompleted ?? "none"}; completedCount=${progress.completedCount}`;
  const message =
    summary === undefined
      ? progressMessage
      : `${progressMessage}; ${timingSuffix(summary)}`;
  assert.equal(result.reason, "exit", message);
  assert.equal(result.code, 0, message);
}
