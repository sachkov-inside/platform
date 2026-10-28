// @ts-check
import { isProxy } from "node:util/types";
// Fixed SDK profile. Marker failures never become producer failures.
import {
  constants,
  closeSync,
  fstatSync,
  lstatSync,
  openSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, resolve } from "node:path";

const phases = [
  "input_validation",
  "hooks_setup",
  "modules_import",
  "provider_acquisition",
  "sdk_acquisition",
  "storage_acquisition",
  "scoped_read",
  "read_contract",
  "sdk_flush",
  "sdk_diagnostics",
  "sdk_shutdown",
  "witness_contract",
  "result_ready",
  "cleanup_sdk",
  "cleanup_provider",
  "cleanup_hooks",
];
/** @typedef {{available:false}|{available:true,saturated:boolean,droppedSpans:number,failedTraceExports:number,failedMetricExports:number}} SdkCounters */
/** @typedef {{enter(phase:string):void,diagnostics(value:unknown):void,exportFailure(signal:string,value:unknown):void,failed():void,completed():void}} SdkEmitterPhase */
const counterLimit = 1_000_000;
/** @param {unknown} value @returns {SdkCounters} */
function counterSnapshot(value) {
  try {
    const fields = [
      "droppedSpans",
      "failedTraceExports",
      "failedMetricExports",
    ];
    if (typeof value !== "object" || value === null)
      return { available: false };
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== fields.length ||
      !keys.every((key) => typeof key === "string" && fields.includes(key))
    )
      return { available: false };
    /** @param {string} key @returns {unknown} */
    const read = (key) => Object.getOwnPropertyDescriptor(value, key)?.value;
    /** @param {unknown} item @returns {item is number} */
    const valid = (item) =>
      typeof item === "number" && Number.isSafeInteger(item) && item >= 0;
    const droppedSpans = read("droppedSpans");
    const failedTraceExports = read("failedTraceExports");
    const failedMetricExports = read("failedMetricExports");
    if (
      !valid(droppedSpans) ||
      !valid(failedTraceExports) ||
      !valid(failedMetricExports)
    )
      return { available: false };
    return {
      available: true,
      saturated: [droppedSpans, failedTraceExports, failedMetricExports].some(
        (item) => item > counterLimit,
      ),
      droppedSpans: Math.min(droppedSpans, counterLimit),
      failedTraceExports: Math.min(failedTraceExports, counterLimit),
      failedMetricExports: Math.min(failedMetricExports, counterLimit),
    };
  } catch {
    return { available: false };
  }
}
/** @typedef {import("../../apps/backend/src/infrastructure/observability/technical-telemetry.js").ExportFailureObservation} ExportFailureObservation */
/** @typedef {{available:false}|{available:true,traces:ExportFailureObservation|null,metrics:ExportFailureObservation|null}} ExportFailures */
/** @param {unknown} value @returns {ExportFailureObservation|null} */
function failureSnapshot(value) {
  try {
    if (typeof value !== "object" || value === null || isProxy(value))
      return null;
    const keys = Reflect.ownKeys(value);
    /** @param {string} key @returns {unknown} */
    const read = (key) => Object.getOwnPropertyDescriptor(value, key)?.value;
    const kind = read("kind"),
      elapsedMs = read("elapsedMs");
    if (!(
      elapsedMs === null ||
      (typeof elapsedMs === "number" &&
        Number.isInteger(elapsedMs) &&
        elapsedMs >= 0 &&
        elapsedMs <= 600000)
    ))
      return null;
    const withCode = kind === "http" || kind === "network";
    const fields = withCode
      ? ["kind", "code", "elapsedMs"]
      : ["kind", "elapsedMs"];
    if (
      keys.length !== fields.length ||
      !keys.every((key) => typeof key === "string" && fields.includes(key))
    )
      return null;
    if (kind === "http") {
      const code = read("code");
      return typeof code === "number" &&
        Number.isInteger(code) &&
        code >= 100 &&
        code <= 599
        ? { kind, code, elapsedMs }
        : null;
    }
    if (kind === "network") {
      const code = /** @type {const} */ ([
        "ECONNRESET",
        "ECONNREFUSED",
        "EPIPE",
        "ETIMEDOUT",
        "EAI_AGAIN",
        "ENOTFOUND",
        "ENETUNREACH",
        "EHOSTUNREACH",
      ]).find((item) => item === read("code"));
      return code === undefined ? null : { kind, code, elapsedMs };
    }
    return kind === "timeout" || kind === "queue" || kind === "unknown"
      ? { kind, elapsedMs }
      : null;
  } catch {
    return null;
  }
}
/** @type {WeakSet<object>} */
const owned = new WeakSet();
/** @param {unknown} value @returns {value is SdkEmitterPhase} */
function isOwned(value) {
  return typeof value === "object" && value !== null && owned.has(value);
}
/** @param {unknown} value @returns {SdkEmitterPhase|null} */
export function admitSdkEmitterPhase(value) {
  return isOwned(value) ? value : null;
}
/** @param {import("node:fs").BigIntStats} a @param {import("node:fs").BigIntStats} b */
function same(a, b) {
  return [
    "dev",
    "ino",
    "uid",
    "gid",
    "mode",
    "nlink",
    "size",
    "mtimeNs",
    "ctimeNs",
  ].every((key) => Reflect.get(a, key) === Reflect.get(b, key));
}
/** @param {import("node:fs").BigIntStats} info @param {number} uid */
function regular(info, uid) {
  return (
    info.isFile() &&
    info.uid === BigInt(uid) &&
    (info.mode & 0o777n) === 0o600n &&
    info.nlink === 1n &&
    info.size <= 512n
  );
}
/** @param {unknown} environment @returns {SdkEmitterPhase|null} */
export function createSdkEmitterPhase(environment) {
  /** @type {number|undefined} */ let directoryFd;
  try {
    if (typeof environment !== "object" || environment === null) return null;
    /** @type {unknown} */
    const path = Reflect.get(environment, "INSIDE_SDK_EMITTER_PHASE_PATH");
    /** @type {unknown} */
    const source = Reflect.get(environment, "INSIDE_SDK_EMITTER_PHASE_SOURCE");
    if (
      typeof path !== "string" ||
      typeof source !== "string" ||
      !/^[0-9a-f]{40}$/u.test(source) ||
      basename(path) !== "phase.json" ||
      resolve(path) !== path ||
      process.getuid === undefined ||
      typeof constants.O_NOFOLLOW !== "number" ||
      typeof constants.O_DIRECTORY !== "number"
    )
      return null;
    const uid = process.getuid();
    const directory = dirname(path);
    const before = lstatSync(directory, { bigint: true });
    if (
      !before.isDirectory() ||
      before.uid !== BigInt(uid) ||
      (before.mode & 0o777n) !== 0o700n ||
      realpathSync(directory) !== directory
    )
      return null;
    directoryFd = openSync(
      directory,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_DIRECTORY,
    );
    if (
      !same(before, fstatSync(directoryFd, { bigint: true })) ||
      !same(before, lstatSync(directory, { bigint: true }))
    )
      throw new Error();
    let anchor;
    for (const prefix of ["/proc/self/fd", "/dev/fd"]) {
      try {
        const candidate = prefix + "/" + directoryFd;
        if (
          realpathSync(candidate) === directory &&
          same(before, statSync(candidate + "/", { bigint: true }))
        ) {
          anchor = candidate;
          break;
        }
      } catch {
        /* Unsupported directory FD traversal leaves this observer absent. */
      }
    }
    if (anchor === undefined) throw new Error();
    const base = anchor;
    const descriptor = directoryFd;
    directoryFd = undefined;
    let open = true;
    let disabled = false;
    let latched = false;
    let current = "input_validation";
    /** @type {SdkCounters|undefined} */ let counters;
    /** @type {ExportFailures} */
    let failures = { available: true, traces: null, metrics: null };
    function close() {
      if (open) {
        open = false;
        try {
          closeSync(descriptor);
        } catch {
          /* Diagnostic only. */
        }
      }
    }
    /** @param {"running"|"failed"|"completed"} state */
    function commit(state) {
      if (disabled || !open) return;
      /** @type {number|undefined} */ let fd;
      /** @type {number|undefined} */ let pin;
      /** @type {import("node:fs").BigIntStats|undefined} */ let created;
      try {
        const parent = lstatSync(directory, { bigint: true });
        const held = fstatSync(descriptor, { bigint: true });
        if (
          parent.dev !== before.dev ||
          parent.ino !== before.ino ||
          parent.uid !== before.uid ||
          parent.gid !== before.gid ||
          parent.mode !== before.mode ||
          !same(parent, held)
        )
          throw new Error();
        const marker = base + "/phase.json";
        const existing = lstatSync(marker, {
          bigint: true,
          throwIfNoEntry: false,
        });
        if (existing !== undefined) {
          fd = openSync(
            marker,
            constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
          );
          if (
            !regular(existing, uid) ||
            !same(existing, fstatSync(fd, { bigint: true })) ||
            !same(existing, lstatSync(marker, { bigint: true }))
          )
            throw new Error();
          const reader = fd;
          fd = undefined;
          closeSync(reader);
        }
        const raw =
          JSON.stringify({
            phase: state === "completed" ? "result_ready" : current,
            reason: state === "failed" ? "operation_failed" : "none",
            schema: 1,
            scope: "sdk",
            source,
            state,
            diagnostics: counters,
            exportFailures: failures,
          }) + "\n";
        if (Buffer.byteLength(raw) > 512) throw new Error();
        fd = openSync(
          base + "/phase.json.new",
          constants.O_WRONLY |
            constants.O_CREAT |
            constants.O_EXCL |
            constants.O_NOFOLLOW,
          0o600,
        );
        created = fstatSync(fd, { bigint: true });
        writeFileSync(fd, raw);
        const info = fstatSync(fd, { bigint: true });
        if (
          !regular(info, uid) ||
          info.size !== BigInt(Buffer.byteLength(raw)) ||
          !same(info, lstatSync(base + "/phase.json.new", { bigint: true }))
        )
          throw new Error();
        // The writer closes before commit; a distinct live pin prevents inode reuse.
        pin = openSync(
          base + "/phase.json.new",
          constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
        );
        if (!same(info, fstatSync(pin, { bigint: true }))) throw new Error();
        const writer = fd;
        fd = undefined;
        closeSync(writer);
        const parentAfter = lstatSync(directory, { bigint: true });
        const heldAfter = fstatSync(descriptor, { bigint: true });
        if (
          parentAfter.dev !== before.dev ||
          parentAfter.ino !== before.ino ||
          parentAfter.uid !== before.uid ||
          parentAfter.gid !== before.gid ||
          parentAfter.mode !== before.mode ||
          !same(parentAfter, heldAfter)
        )
          throw new Error();
        if (!same(info, lstatSync(base + "/phase.json.new", { bigint: true })))
          throw new Error();
        renameSync(base + "/phase.json.new", marker);
        created = undefined;
      } catch {
        disabled = true;
      } finally {
        if (created !== undefined) {
          try {
            const named = lstatSync(base + "/phase.json.new", {
              bigint: true,
              throwIfNoEntry: false,
            });
            const live = pin ?? fd;
            const held =
              live === undefined
                ? undefined
                : fstatSync(live, { bigint: true });
            if (
              held !== undefined &&
              held.dev === created.dev &&
              held.ino === created.ino &&
              named !== undefined &&
              regular(named, uid) &&
              named.gid === created.gid &&
              named.dev === created.dev &&
              named.ino === created.ino
            )
              unlinkSync(base + "/phase.json.new");
          } catch {
            disabled = true;
          }
        }
        // Named cleanup must finish while the original inode is still pinned.
        for (const owned of [fd, pin]) {
          if (owned !== undefined) {
            try {
              closeSync(owned);
            } catch {
              disabled = true;
            }
          }
        }
        if (disabled) close();
      }
    }
    const observer = Object.freeze({
      /** @param {string} signal @param {unknown} value */
      exportFailure(signal, value) {
        if (latched || disabled || !failures.available) return;
        if (signal !== "traces" && signal !== "metrics")
          failures = { available: false };
        else {
          if (failures[signal] !== null) return;
          const row = failureSnapshot(value);
          if (row === null) failures = { available: false };
          else failures[signal] = row;
        }
        commit("running");
      },
      /** @param {unknown} value */
      diagnostics(value) {
        if (latched || disabled || current !== "sdk_diagnostics") return;
        counters = counterSnapshot(value);
        commit("running");
      },
      /** @param {string} phase */
      enter(phase) {
        if (latched || disabled) return;
        if (
          typeof phase !== "string" ||
          !phases.includes(phase) ||
          phase === "result_ready"
        ) {
          disabled = true;
          close();
          return;
        }
        current = phase;
        commit("running");
      },
      failed() {
        if (latched || disabled) return;
        latched = true;
        commit("failed");
        close();
      },
      completed() {
        if (latched || disabled) return;
        latched = true;
        commit("completed");
        close();
      },
    });
    owned.add(observer);
    return observer;
  } catch {
    return null;
  } finally {
    if (directoryFd !== undefined) {
      try {
        closeSync(directoryFd);
      } catch {
        /* Factory absence never changes producer work. */
      }
    }
  }
}
