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

const PROTOCOL_METHODS = Object.freeze([
  "test_inventory_preserves_all_baseline_methods_and_exact_additions",
  "test_markers_preserve_first_primary_and_completed_is_not_success",
  "test_runner_uses_original_discovery_and_refuses_inventory_drift",
]);
const PROTOCOL_UNKNOWN = "Core protocol: unknown";
/** @param {unknown} stderr */
function protocolFailureMessage(stderr) {
  if (typeof stderr !== "string" || Buffer.byteLength(stderr) > 1_048_576)
    return PROTOCOL_UNKNOWN;
  let offset = 0;
  while (offset < stderr.length) {
    const end = stderr.indexOf("\n", offset);
    const line = stderr.slice(offset, end < 0 ? stderr.length : end);
    offset = end < 0 ? stderr.length : end + 1;
    if (!line.includes("CORE_PROTOCOL")) continue;
    if (end !== stderr.length - 1 || Buffer.byteLength(line) + 1 > 64)
      return PROTOCOL_UNKNOWN;
    const match =
      /^CORE_PROTOCOL_V1 failures ([-FE]{3})(?: field (exit|program|warnings|tests|failures|errors|skips|discovery|output)| stage (owner_import|source_shape|inventory_guard|stdlib_imports|fixture_setup|import_order|execution|record|import_list|comparison_tail|count|exit|refusal|import_guard|import_tail))?$/u.exec(
        line,
      );
    const vector = match?.[1];
    const field = match?.[2];
    const stage = match?.[3];
    if (
      vector === undefined ||
      vector === "---" ||
      ((field !== undefined || stage !== undefined) && vector[2] === "-")
    )
      return PROTOCOL_UNKNOWN;
    return (
      "Core protocol: " +
      PROTOCOL_METHODS.flatMap((method, index) => {
        const category = vector[index];
        return category === "-"
          ? []
          : [method + "=" + (category === "F" ? "failure" : "error")];
      }).join("; ") +
      (field !== undefined
        ? `; field=${field}`
        : stage !== undefined
          ? `; stage=${stage}`
          : "")
    );
  }
  return PROTOCOL_UNKNOWN;
}

/** The separate three-method protocol retains its native verdict; no274 progress claim.
 * @param {unknown} result
 */
export function assertCoreProtocolContracts(result) {
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
    assert.fail(PROTOCOL_UNKNOWN);
  const failedSpawn = error.value !== undefined;
  if (status.value === 0 && signal.value === null && !failedSpawn) return;
  let mayRead = !failedSpawn;
  if (failedSpawn) {
    const code = data(error.value, "code");
    mayRead =
      code.valid === true &&
      code.present === true &&
      code.value === "ETIMEDOUT";
  }
  let message = PROTOCOL_UNKNOWN;
  if (mayRead) {
    const stderr = data(result, "stderr");
    if (stderr.valid && stderr.present)
      message = protocolFailureMessage(stderr.value);
  }
  assert.equal(status.value, 0, message);
  assert.ok(signal.value === null, message);
  assert.ok(!failedSpawn, message);
}
