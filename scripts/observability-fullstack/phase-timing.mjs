// @ts-check
import { PerformanceObserver, constants } from "node:perf_hooks";
/** Numeric diagnostics only. None of these fields participates in acceptance. */
/** @typedef {[number,number,number|null,number|null,number|null,number|null,number|null,number|null,number|null,number|null,number]} WebRow */
/** @typedef {{schema:number,state:string,rows:WebRow[],overflow:number,invalid:number}} WebTransport */
/** @typedef {{schema:number,width:number,state:string,rows:(number|null)[],overflow:number,invalid:number}} FlatTransport */
/** @typedef {{schema:number,width:number,state:string,rows:number[],overflow:number,invalid:number}} ClientWork */
/** @typedef {ClientWork & {capture_start_us:number|null,capture_end_us:number|null,tail_complete:false,excluded:number}} ClientGc */
/** @typedef {{begin:(at:number)=>void,attach:(req:import('node:events').EventEmitter & {socket?:import('node:events').EventEmitter|null})=>void,submitted:()=>void,headers:()=>void,bodyEnd:()=>void,decoded:()=>void,finish:(at:number,failure:number,additiveFault?:boolean)=>void}} RequestObserver */
const REQUEST_LIMIT = 400;
const OBSERVER_LIMIT = 128;
const PHASE_WINDOW_MS = 600_000;
const failures = [
  "metrics_http",
  "metrics_response",
  "logs_http",
  "traces_http",
  "traces_response",
  "umami_http",
  "umami_response",
  "source_cache_http",
  "source_cache_response",
];

/** @param {number} before @param {number} epoch @param {number} after */
function clock(before, epoch, after) {
  return Number.isFinite(before) &&
    before >= 0 &&
    Number.isFinite(after) &&
    after >= before &&
    after <= Number.MAX_SAFE_INTEGER &&
    Number.isSafeInteger(epoch) &&
    epoch >= 0
    ? [before, epoch, after]
    : null;
}

/** @param {number} phase @param {number} pair @param {number} before @param {number} epoch @param {number} after */
export function phaseTiming(phase, pair, before, epoch, after) {
  const anchor = clock(before, epoch, after);
  const validPhase =
    Number.isSafeInteger(phase) &&
    phase >= 0 &&
    phase < 12 &&
    Number.isSafeInteger(pair) &&
    pair >= 0 &&
    pair < 2 &&
    Math.floor(phase / 6) === pair;
  const valid = validPhase && anchor !== null;
  /** @type {{phase:number|null,pair:number|null,phase_start:number[]|null,phase_end:number[]|null,state:string,requests:number[][],observer_rounds:number[][],request_overflow:number,observer_overflow:number,invalid_rows:number,web_transport?:WebTransport,request_transport?:FlatTransport,client_work?:ClientWork,client_gc?:ClientGc}} */
  const result = {
    phase: validPhase ? phase : null,
    pair: validPhase ? pair : null,
    phase_start: anchor,
    /** @type {number[] | null} */ phase_end: null,
    state: valid ? "recording" : "invalid",
    /** @type {number[][]} */ requests: [],
    /** @type {number[][]} */ observer_rounds: [],
    request_overflow: 0,
    observer_overflow: 0,
    invalid_rows: valid ? 0 : 1,
  };
  function invalid() {
    result.invalid_rows++;
    result.state = "invalid";
  }
  function overflow() {
    if (result.state !== "invalid") result.state = "overflow";
  }
  /** @param {number} start @param {number} end */
  function window(start, end) {
    return (
      anchor !== null &&
      Number.isFinite(start) &&
      Number.isFinite(end) &&
      start >= before &&
      end >= start &&
      end - before <= PHASE_WINDOW_MS
    );
  }
  let webPending = 0,
    requestPending = 0,
    workSealed = false;
  /** @type {PerformanceObserver | undefined} */ let gcObserver;
  let gcSealed = false;
  /** @type {number | undefined} */ let gcStart;
  /** @type {number | undefined} */ let gcEnd;
  /** Retained only until settlement; validate the original clock before quantization. @type {number[]} */ const gcRawEnds =
    [];
  /** @param {ClientGc} leaf */
  function gcFault(leaf) {
    leaf.invalid = Math.min(Number.MAX_SAFE_INTEGER, leaf.invalid + 1);
    if (leaf.state !== "overflow") leaf.state = "unavailable";
  }
  function disconnectGc() {
    gcSealed = true;
    try {
      gcObserver?.disconnect();
    } catch {
      if (result.client_gc) gcFault(result.client_gc);
    }
    gcObserver = undefined;
  }
  /** Native delivery can still be pending after takeRecords; never claim a complete tail.
   * @param {unknown[]} entries
   */
  function gcEntries(entries) {
    const leaf = result.client_gc;
    if (gcSealed || !leaf) return;
    for (const raw of entries) {
      if (gcSealed) break;
      try {
        if (raw === null || typeof raw !== "object") throw new Error("entry");
        /** @type {unknown} */ const type = Reflect.get(raw, "entryType");
        /** @type {unknown} */ const start = Reflect.get(raw, "startTime");
        /** @type {unknown} */ const duration = Reflect.get(raw, "duration");
        /** @type {unknown} */ const detail = Reflect.get(raw, "detail");
        if (
          type !== "gc" ||
          typeof start !== "number" ||
          typeof duration !== "number" ||
          !Number.isFinite(duration) ||
          duration < 0 ||
          detail === null ||
          typeof detail !== "object"
        )
          throw new Error("entry");
        /** @type {unknown} */ const rawKind = Reflect.get(detail, "kind");
        if (typeof rawKind !== "number") throw new Error("kind");
        const kind = [
          constants.NODE_PERFORMANCE_GC_MINOR,
          constants.NODE_PERFORMANCE_GC_MAJOR,
          constants.NODE_PERFORMANCE_GC_INCREMENTAL,
          constants.NODE_PERFORMANCE_GC_WEAKCB,
        ].indexOf(rawKind);
        const end = start + duration;
        if (kind < 0 || !window(start, end) || gcStart === undefined)
          throw new Error("entry");
        if (start < gcStart || (gcEnd !== undefined && start > gcEnd)) {
          leaf.excluded = Math.min(Number.MAX_SAFE_INTEGER, leaf.excluded + 1);
          continue;
        }
        if (gcEnd !== undefined && end > gcEnd) throw new Error("boundary");
        leaf.rows.push(
          kind + 1,
          Math.floor((start - before) * 1000),
          Math.floor((end - before) * 1000),
        );
        gcRawEnds.push(end);
        if (leaf.rows.length >= 512 * 3) {
          leaf.state = "overflow";
          leaf.overflow++;
          disconnectGc();
        }
      } catch {
        gcFault(leaf);
      }
    }
  }
  const ordinals = new Set();
  /** One event/clock feeds both views; the legacy view retains raw millisecond precision.
   * @param {number} ordinal @param {number} kind @param {boolean} general
   * @returns {RequestObserver | undefined}
   */
  function requestObserver(ordinal, kind, general) {
    const web =
      kind < 2 || !general
        ? (result.web_transport ??= {
            schema: 1,
            state: "complete",
            rows: [],
            overflow: 0,
            invalid: 0,
          })
        : undefined;
    const leaf = general
      ? (result.request_transport ??= {
          schema: 1,
          width: 13,
          state: "complete",
          rows: [],
          overflow: 0,
          invalid: 0,
        })
      : undefined;
    const refused =
      !valid ||
      !Number.isSafeInteger(ordinal) ||
      ordinal < 0 ||
      ordinal >= REQUEST_LIMIT ||
      !(general ? [0, 1, 2, 3, 6, 7] : [0, 1]).includes(kind) ||
      ordinal % 8 !== kind;
    const fail = () => {
      for (const item of [web, leaf])
        if (item) {
          item.invalid++;
          item.state = "unavailable";
        }
    };
    if (refused) {
      fail();
      return undefined;
    }
    if (
      (web && web.rows.length >= 100) ||
      (leaf && leaf.rows.length >= 300 * 13)
    ) {
      for (const item of [web, leaf])
        if (item) {
          item.overflow++;
          item.state = "overflow";
        }
      return undefined;
    }
    if (
      (leaf && ordinals.has(ordinal)) ||
      web?.rows.some((row) => row[0] === ordinal)
    ) {
      fail();
      return undefined;
    }
    /** @type {(number|null)[]} */ const raw = [
      ordinal,
      kind,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      0,
    ];
    /** @type {WebRow | undefined} */ const legacy = web
      ? [ordinal, kind, null, null, null, null, null, null, null, null, 0]
      : undefined;
    const offset = leaf?.rows.length ?? 0;
    if (leaf) {
      leaf.rows.push(...raw);
      ordinals.add(ordinal);
      requestPending++;
      if (leaf.state === "complete") leaf.state = "partial";
    }
    if (web && legacy) {
      web.rows.push(legacy);
      webPending++;
      if (web.state === "complete") web.state = "partial";
    }
    /** @type {[import('node:events').EventEmitter,string,()=>void][]} */ const listeners =
      [];
    let settled = false,
      broken = false,
      webBroken = false,
      attached = false;
    /** @param {boolean} [shared] */
    const bad = (shared = true) => {
      if (leaf && !broken) {
        leaf.invalid++;
        broken = true;
      }
      if (web && shared && !webBroken) {
        web.invalid++;
        webBroken = true;
      }
    };
    const detach = () => {
      for (const [emitter, event, fn] of listeners.splice(0)) {
        try {
          emitter.off(event, fn);
        } catch {
          bad();
        }
      }
    };
    /** @param {number} column @param {number} at */
    const mark = (column, at) => {
      if (settled) return;
      if (
        raw[column] !== null ||
        !Number.isFinite(at) ||
        at < before ||
        at - before > PHASE_WINDOW_MS
      ) {
        bad(column !== 9 && column !== 10);
        return;
      }
      const elapsed = at - before;
      raw[column] = elapsed;
      if (leaf) leaf.rows[offset + column] = Math.floor(elapsed * 1000);
      if (legacy && column <= 8) legacy[column] = elapsed;
      if (legacy && column === 11) legacy[9] = elapsed;
    };
    /** @param {()=>void} action @param {boolean} [shared] */
    const safe = (action, shared = true) => {
      if (settled) return;
      try {
        action();
      } catch {
        bad(shared);
        detach();
      }
    };
    /** @param {import('node:events').EventEmitter} emitter @param {string} event @param {()=>void} action */
    const listen = (emitter, event, action) => {
      const fn = () => safe(action);
      listeners.push([emitter, event, fn]);
      emitter.once(event, fn);
    };
    return {
      begin(at) {
        safe(() => mark(2, at));
      },
      attach(req) {
        safe(() => {
          if (attached) {
            bad();
            detach();
            return;
          }
          attached = true;
          listen(req, "socket", () => {
            mark(4, performance.now());
            const socket = req.socket;
            if (socket == null) {
              bad();
              return;
            }
            listen(socket, "connect", () => mark(5, performance.now()));
            listen(socket, "secureConnect", () => mark(6, performance.now()));
          });
          listen(req, "finish", () => mark(7, performance.now()));
        });
      },
      submitted() {
        safe(() => mark(3, performance.now()));
      },
      headers() {
        safe(() => mark(8, performance.now()));
      },
      bodyEnd() {
        if (leaf) safe(() => mark(9, performance.now()), false);
      },
      decoded() {
        if (leaf) safe(() => mark(10, performance.now()), false);
      },
      finish(at, failure, additiveFault = false) {
        if (settled) return;
        safe(() => {
          mark(11, at);
          if (additiveFault) bad(false);
          if (!Number.isInteger(failure) || failure < 0 || failure > 5) {
            bad();
            failure = 5;
          }
          /** @type {[number,number][]} */ const branches = [
            [2, 3],
            [2, 4],
            [4, 5],
            [5, 6],
            [3, 7],
            [6, 8],
            [2, 11],
          ];
          if (leaf) branches.push([8, 9], [9, 10], [10, 11]);
          for (const [left, right] of branches) {
            const a = raw[left],
              b = raw[right];
            if (typeof a === "number" && typeof b === "number" && a > b)
              bad(right !== 9 && right !== 10 && left !== 10);
          }
          for (let col = 2; col < 12; col++) {
            const value = raw[col],
              end = raw[11],
              start = raw[2];
            if (
              typeof value === "number" &&
              ((typeof end === "number" && value > end) ||
                (typeof start === "number" && value < start))
            )
              bad(col !== 9 && col !== 10);
          }
          if (legacy && legacy.slice(2, 9).some((v) => v === null)) bad();
          if (
            leaf &&
            raw
              .slice(2, 12)
              .some((v, index) => v === null && !(index + 2 === 6 && kind >= 6))
          )
            bad(false);
          if (leaf && kind >= 6 && raw[6] !== null) bad(false);
          if (failure === 5) bad();
          if (legacy) legacy[10] = webBroken && failure === 0 ? 5 : failure;
          if (leaf)
            leaf.rows[offset + 12] = broken && failure === 0 ? 5 : failure;
        });
        detach();
        settled = true;
        if (
          web &&
          --webPending === 0 &&
          web.invalid === 0 &&
          web.overflow === 0
        )
          web.state = "complete";
        if (
          leaf &&
          --requestPending === 0 &&
          leaf.invalid === 0 &&
          leaf.overflow === 0
        )
          leaf.state = "complete";
      },
    };
  }
  return {
    result,
    /** @param {typeof PerformanceObserver} [Observer] */
    startGc(Observer = PerformanceObserver) {
      if (result.client_gc) {
        gcFault(result.client_gc);
        disconnectGc();
        return;
      }
      /** @type {ClientGc} */ const leaf = (result.client_gc = {
        schema: 1,
        width: 3,
        state: "observed",
        capture_start_us: null,
        capture_end_us: null,
        tail_complete: false,
        rows: [],
        overflow: 0,
        invalid: 0,
        excluded: 0,
      });
      try {
        gcStart = performance.now();
        if (
          !valid ||
          !window(gcStart, gcStart) ||
          !Observer.supportedEntryTypes.includes("gc")
        )
          throw new Error("gc");
        leaf.capture_start_us = Math.floor((gcStart - before) * 1000);
        gcObserver = new Observer((list) => {
          try {
            gcEntries(list.getEntries());
          } catch {
            gcFault(leaf);
            disconnectGc();
          }
        });
        gcObserver.observe({ entryTypes: ["gc"] });
      } catch {
        gcFault(leaf);
        disconnectGc();
      }
    },
    stopClient() {
      workSealed = true;
      if (gcSealed) return;
      const leaf = result.client_gc;
      try {
        if (leaf && gcEnd === undefined) {
          const end = performance.now();
          if (!window(before, end)) throw new Error("clock");
          gcEnd = end;
          leaf.capture_end_us = Math.floor((end - before) * 1000);
        }
        if (gcObserver) gcEntries(gcObserver.takeRecords());
      } catch {
        if (leaf) gcFault(leaf);
      } finally {
        disconnectGc();
      }
    },
    /** @param {number} ordinal @param {number} kind */
    webRequest(ordinal, kind) {
      return requestObserver(ordinal, kind, false);
    },
    /** @param {number} ordinal @param {number} kind */
    requestTransport(ordinal, kind) {
      return requestObserver(ordinal, kind, true);
    },
    /** The action always runs exactly once, including when diagnostics fail.
     * @template T @param {number} kind @param {()=>T} action @returns {T}
     */
    work(kind, action) {
      if (workSealed) return action();
      const leaf = (result.client_work ??= {
        schema: 1,
        width: 4,
        state: "observed",
        rows: [],
        overflow: 0,
        invalid: 0,
      });
      if (leaf.rows.length >= 4096 * 4) {
        leaf.overflow = Math.min(Number.MAX_SAFE_INTEGER, leaf.overflow + 1);
        leaf.state = "overflow";
        return action();
      }
      /** @type {number | undefined} */ let start;
      try {
        start = performance.now();
      } catch {
        /* Original action still owns its exception. */
      }
      let failure = 0;
      const recordWork = () => {
        try {
          const end = performance.now();
          if (
            !valid ||
            !Number.isInteger(kind) ||
            kind < 0 ||
            kind > 10 ||
            start === undefined ||
            !window(start, end)
          )
            throw new Error("clock");
          leaf.rows.push(
            kind,
            Math.floor((start - before) * 1000),
            Math.floor((end - before) * 1000),
            failure,
          );
        } catch {
          leaf.invalid = Math.min(Number.MAX_SAFE_INTEGER, leaf.invalid + 1);
          if (leaf.state !== "overflow") leaf.state = "unavailable";
        }
      };
      try {
        return action();
      } catch (error) {
        failure = 1;
        throw error;
      } finally {
        recordWork();
      }
    },
    /** @param {number} ordinal @param {number} kind @param {number} start @param {number} end */
    request(ordinal, kind, start, end) {
      if (
        !Number.isSafeInteger(ordinal) ||
        ordinal < 0 ||
        ordinal >= REQUEST_LIMIT ||
        ![0, 1, 2, 3, 6, 7].includes(kind) ||
        !window(start, end)
      ) {
        invalid();
        return;
      }
      if (result.requests.length >= REQUEST_LIMIT) {
        result.request_overflow++;
        overflow();
      } else
        result.requests.push([ordinal, kind, start - before, end - before]);
    },
    /** @param {number} ordinal @param {number} start @param {number} end @param {unknown} failure */
    observer(ordinal, start, end, failure) {
      const code =
        failure === undefined
          ? 0
          : typeof failure === "string" && failures.includes(failure)
            ? failures.indexOf(failure) + 1
            : -1;
      if (
        !Number.isSafeInteger(ordinal) ||
        ordinal < 0 ||
        !window(start, end) ||
        code < 0
      ) {
        invalid();
        return;
      }
      if (result.observer_rounds.length >= OBSERVER_LIMIT) {
        result.observer_overflow++;
        overflow();
      } else
        result.observer_rounds.push([
          ordinal,
          start - before,
          end - before,
          code,
        ]);
    },
    /** @param {number} start @param {number} at @param {number} end */
    finish(start, at, end) {
      workSealed = true;
      if (result.client_gc && window(before, end)) {
        gcEnd = end;
        result.client_gc.capture_end_us = Math.floor((end - before) * 1000);
        // Reject a delivered entry crossing the final original phase boundary.
        for (const rawEnd of gcRawEnds)
          if (rawEnd > end) gcFault(result.client_gc);
      }
      const anchorEnd = clock(start, at, end);
      if (anchorEnd === null || !window(start, end)) invalid();
      else result.phase_end = anchorEnd;
      if (result.state === "recording") result.state = "complete";
    },
  };
}

/** @typedef {{kind:number,stage:number,acquired:number,changed:number}} SlotRecord */
/** First refusal only; the caller's existing active Set remains the scheduling authority.
 * @param {number} phase @param {boolean} enabled @param {number} origin
 */
export function slotOccupancy(phase, enabled, origin) {
  /** @type {Map<Promise<void>,SlotRecord>} */ const live = new Map();
  /** @type {{schema:number,state:string,reason?:string,phase?:number,mode?:string,decision_us?:number,slots?:number[][]}} */
  let result = { schema: 1, state: "not_refused" };
  let sealed = false;
  let lastClock = -1;
  /** @param {string} reason */
  function unavailable(reason) {
    result = { schema: 1, state: "unavailable", reason };
    sealed = true;
    live.clear();
  }
  function clock() {
    try {
      const value = Math.floor((performance.now() - origin) * 1000);
      if (
        !Number.isSafeInteger(value) ||
        value < lastClock ||
        value < 0 ||
        value > 600_000_000
      )
        throw new Error("clock");
      lastClock = value;
      return value;
    } catch {
      unavailable("clock");
      return undefined;
    }
  }
  if (
    !Number.isInteger(phase) ||
    phase < 0 ||
    phase > 11 ||
    typeof enabled !== "boolean" ||
    !Number.isFinite(origin) ||
    origin < 0
  )
    unavailable("bounds");
  return {
    /** @param {number} kind @returns {SlotRecord | undefined} */
    acquire(kind) {
      if (sealed) return undefined;
      if (!Number.isInteger(kind) || kind < 0 || kind > 7) {
        unavailable("bounds");
        return undefined;
      }
      const at = clock();
      return at === undefined
        ? undefined
        : { kind, stage: enabled ? 0 : 1, acquired: at, changed: at };
    },
    /** @param {Promise<void>} work @param {SlotRecord | undefined} entry */
    attach(work, entry) {
      if (sealed || entry === undefined) return;
      if (live.size >= 8) unavailable("bounds");
      else live.set(work, entry);
    },
    /** @param {SlotRecord | undefined} entry @param {number} stage */
    stage(entry, stage) {
      if (sealed || entry === undefined) return;
      const at = clock();
      if (at === undefined) return;
      if (
        ![1, 2].includes(stage) ||
        stage < entry.stage ||
        at < entry.changed
      ) {
        unavailable("bounds");
        return;
      }
      entry.stage = stage;
      entry.changed = at;
    },
    /** @param {Promise<void>} work */
    release(work) {
      live.delete(work);
    },
    refuse() {
      if (sealed) return;
      // Latch before copying: later refusals never replace the first attempt.
      sealed = true;
      const at = clock();
      if (at === undefined) return;
      try {
        if (live.size !== 8) {
          unavailable("capture");
          return;
        }
        const slots = [...live.values()]
          .sort((a, b) => a.acquired - b.acquired)
          .map((entry) => {
            if (entry.changed > at) throw new Error("clock");
            return [
              entry.kind,
              entry.stage,
              entry.acquired,
              entry.changed,
              at - entry.acquired,
              at - entry.changed,
            ];
          });
        const captured = {
          schema: 1,
          state: "captured",
          phase,
          mode: enabled ? "on" : "off",
          decision_us: at,
          slots,
        };
        if (Buffer.byteLength(JSON.stringify(captured)) > 2048)
          unavailable("bounds");
        else result = captured;
      } catch {
        unavailable("capture");
      } finally {
        live.clear();
      }
    },
    result() {
      return result;
    },
  };
}
