// @ts-check
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { types } from "node:util";

const raw = readFileSync(new URL("./source-tests.json", import.meta.url));
if (raw.length > 32768) throw new Error("closed Core source inventory refused");
/** @type {unknown} */
const inventory = JSON.parse(raw.toString("utf8"));
if (!Array.isArray(inventory) || inventory.length !== 274)
  throw new Error("closed Core source inventory refused");
/** @type {string[]} */
const ids = [];
for (const value of inventory) {
  const previous = ids.at(-1);
  if (
    typeof value !== "string" ||
    value.length > 192 ||
    !/^test_[a-z0-9_]+\.[A-Za-z][A-Za-z0-9]*\.test_[A-Za-z0-9_]+$/u.test(
      value,
    ) ||
    (previous !== undefined && value <= previous)
  )
    throw new Error("closed Core source inventory refused");
  ids.push(value);
}
Object.freeze(ids);

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
    if (!line.includes("CORE_SOURCE")) continue;
    markerBytes += Buffer.byteLength(line) + 1;
    if (end < 0 || markerBytes > 131072) return null;
    if (active === null) {
      const expected = ids[completedCount];
      if (expected === undefined || line !== `CORE_SOURCE_V1 start ${expected}`)
        return null;
      active = expected;
      lastStarted = expected;
    } else {
      if (line !== `CORE_SOURCE_V1 completed ${active}`) return null;
      lastCompleted = active;
      active = null;
      completedCount += 1;
    }
  }
  return lastStarted === null
    ? null
    : { lastStarted, lastCompleted, completedCount };
}

const UNKNOWN = "Core source progress: unknown";
/** @param {unknown} value @param {string} key */
function data(value, key) {
  if (typeof value !== "object" || value === null || types.isProxy(value))
    return { valid: false };
  try {
    const property = Object.getOwnPropertyDescriptor(value, key);
    if (property === undefined)
      return { valid: true, present: false, value: undefined };
    if (!("value" in property)) return { valid: false };
    return {
      valid: true,
      present: true,
      value: /** @type {unknown} */ (property.value),
    };
  } catch {
    return { valid: false };
  }
}

/** Native spawnSync outcome remains authoritative; captured payloads never enter assertions.
 * @param {unknown} result
 */
export function assertCoreContracts(result) {
  const status = data(result, "status");
  const signal = data(result, "signal");
  const error = data(result, "error");
  if (
    !status.valid ||
    !status.present ||
    !(
      status.value === null ||
      (typeof status.value === "number" &&
        Number.isSafeInteger(status.value) &&
        status.value >= 0)
    ) ||
    !signal.valid ||
    !signal.present ||
    !(
      signal.value === null ||
      (typeof signal.value === "string" &&
        signal.value.length <= 16 &&
        /^SIG[A-Z0-9]+$/u.test(signal.value))
    ) ||
    !error.valid
  )
    assert.fail(UNKNOWN);
  const failedSpawn = error.value !== undefined;
  let mayReadProgress = !failedSpawn;
  if (failedSpawn) {
    const code = data(error.value, "code");
    // In particular ENOBUFS never inspects stderr or parses a partial capture.
    mayReadProgress =
      code.valid === true &&
      code.present === true &&
      code.value === "ETIMEDOUT";
  }
  let progress = null;
  if (mayReadProgress) {
    const stderr = data(result, "stderr");
    if (stderr.valid && stderr.present) progress = sourceProgress(stderr.value);
  }
  const message =
    progress === null
      ? UNKNOWN
      : `Core source progress: lastStarted=${progress.lastStarted}; lastCompleted=${progress.lastCompleted ?? "none"}; completedCount=${progress.completedCount}`;
  assert.equal(status.value, 0, message);
  assert.ok(signal.value === null, message);
  assert.ok(!failedSpawn, message);
}
