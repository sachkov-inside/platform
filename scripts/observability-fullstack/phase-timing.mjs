// @ts-check
/** Numeric diagnostics only. None of these fields participates in acceptance. */
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
  return {
    result,
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
      const anchorEnd = clock(start, at, end);
      if (anchorEnd === null || !window(start, end)) invalid();
      else result.phase_end = anchorEnd;
      if (result.state === "recording") result.state = "complete";
    },
  };
}
