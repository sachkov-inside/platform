// @ts-check
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const paymentEvents = /** @type {const} */ ([
  "command",
  "dispatch",
  "init_reply",
  "lose_reply",
  "retire",
  "bank_captures",
  "bank_declines",
  "bank_refunds",
  "callback",
  "poll",
  "stale_callback",
  "bank_unavailable",
  "worker_unavailable",
  "fulfill",
  "owner_revoke",
]);
/** @typedef {typeof paymentEvents[number]} PaymentEvent */
/** @typedef {{phase:"absent"|"prepared"|"unknown"|"pending"|"confirmed"|"failed", bank:"unpaid"|"declined"|"captured"|"refunded", initSent:boolean, observedCapture:boolean, issued:boolean, revoked:boolean, retiredBeforeInit:boolean, purchaseCount:number, initCount:number, issueCount:number}} PaymentState */
/** @typedef {(state:PaymentState,event:PaymentEvent)=>PaymentState} Transition */
/** @typedef {{states:number,edges:number,progressChecks:number,complete:boolean,maxDepth:number,counterexample:null|{rule:string,trace:PaymentEvent[]}}} ModelReport */

/** @returns {PaymentState} */
export function initialPayment() {
  return {
    phase: "absent",
    bank: "unpaid",
    initSent: false,
    observedCapture: false,
    issued: false,
    revoked: false,
    retiredBeforeInit: false,
    purchaseCount: 0,
    initCount: 0,
    issueCount: 0,
  };
}

/** Reference transitions from the existing one-time Product contracts (#2252). @type {Transition} */
export function stepPayment(state, event) {
  switch (event) {
    case "command":
      return state.phase === "absent"
        ? {
            ...state,
            phase: "prepared",
            purchaseCount: state.purchaseCount + 1,
          }
        : state;
    case "dispatch":
      return state.phase === "prepared" && !state.retiredBeforeInit
        ? {
            ...state,
            phase: "unknown",
            initSent: true,
            initCount: state.initCount + 1,
          }
        : state;
    case "init_reply":
      return state.initSent &&
        state.phase === "unknown" &&
        !state.observedCapture &&
        state.bank === "unpaid"
        ? { ...state, phase: "pending" }
        : state;
    case "retire":
      return state.phase === "prepared"
        ? { ...state, phase: "failed", retiredBeforeInit: true }
        : state;
    case "bank_captures":
      return state.initSent && state.bank !== "refunded"
        ? { ...state, bank: "captured" }
        : state;
    case "bank_declines":
      return state.initSent && state.bank === "unpaid"
        ? { ...state, bank: "declined" }
        : state;
    case "bank_refunds":
      return state.bank === "captured" ? { ...state, bank: "refunded" } : state;
    case "callback":
    case "poll":
      if (!state.initSent || state.observedCapture) return state;
      if (state.bank === "captured" || state.bank === "refunded")
        return { ...state, phase: "confirmed", observedCapture: true };
      return {
        ...state,
        phase: state.bank === "declined" ? "failed" : "pending",
      };
    case "stale_callback":
      return state.initSent &&
        !state.observedCapture &&
        state.phase !== "failed"
        ? { ...state, phase: "pending" }
        : state;
    case "fulfill":
      return state.observedCapture && !state.issued
        ? { ...state, issued: true, issueCount: state.issueCount + 1 }
        : state;
    case "owner_revoke":
      return state.issued ? { ...state, revoked: true } : state;
    case "lose_reply":
    case "bank_unavailable":
    case "worker_unavailable":
      return state;
  }
}

/** @param {readonly PaymentEvent[]} trace @param {PaymentState} [start] */
export function replayPayment(trace, start = initialPayment()) {
  return trace.reduce(stepPayment, start);
}

/** @param {PaymentState} state @returns {string|null} */
function stateViolation(state) {
  if (state.purchaseCount > 1) return "one_purchase_per_command";
  if (state.initCount > 1) return "one_init_per_purchase";
  if (state.issueCount > 1) return "one_access_issuance";
  if (
    state.issued &&
    (!state.observedCapture ||
      (state.bank !== "captured" && state.bank !== "refunded"))
  )
    return "capture_before_access";
  if (
    state.retiredBeforeInit &&
    (state.initCount !== 0 || state.issueCount !== 0)
  )
    return "retired_before_init_never_sends";
  return null;
}

/**
 * Finite breadth-first exploration, bounded to depth12/2000 states. Progress assumes successful
 * fair poll+fulfillment, not a promise that an unavailable bank or worker recovers (#2252).
 * @param {Transition} [transition]
 * @returns {ModelReport}
 */
export function checkModel(transition = stepPayment) {
  /** @type {Array<{state:PaymentState,trace:PaymentEvent[]}>} */
  const queue = [{ state: initialPayment(), trace: [] }];
  const seen = new Set([JSON.stringify(queue[0]?.state)]);
  /** @type {ModelReport} */
  const report = {
    states: 1,
    edges: 0,
    progressChecks: 0,
    complete: true,
    maxDepth: 0,
    counterexample: null,
  };
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index];
    if (current === undefined) throw new Error("Missing queued state");
    const { state, trace } = current;
    if (
      state.initSent &&
      (state.bank === "captured" || state.bank === "refunded") &&
      !state.revoked &&
      !state.issued
    ) {
      report.progressChecks++;
      const progressed = transition(transition(state, "poll"), "fulfill");
      if (!progressed.issued)
        return {
          ...report,
          complete: false,
          counterexample: {
            rule: "eventual_access_under_fair_recovery",
            trace: [...trace, "poll", "fulfill"],
          },
        };
    }
    for (const event of paymentEvents) {
      const next = transition(state, event);
      report.edges++;
      const violation =
        stateViolation(next) ??
        (state.revoked && !next.revoked
          ? "bank_replay_keeps_owner_withdrawal"
          : null) ??
        (event !== "owner_revoke" && !state.revoked && next.revoked
          ? "only_owner_revokes"
          : null);
      const nextTrace = [...trace, event];
      if (violation !== null)
        return {
          ...report,
          complete: false,
          counterexample: { rule: violation, trace: nextTrace },
        };
      const key = JSON.stringify(next);
      if (seen.has(key)) continue;
      if (trace.length >= 12 || seen.size >= 2000) {
        report.complete = false;
        continue;
      }
      seen.add(key);
      queue.push({ state: next, trace: nextTrace });
      report.states = seen.size;
      report.maxDepth = Math.max(report.maxDepth, nextTrace.length);
    }
  }
  return report;
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const report = checkModel();
  const output = resolve(process.argv[2] ?? ".reports/2252/model.json");
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  if (!report.complete || report.counterexample !== null) process.exitCode = 1;
}
