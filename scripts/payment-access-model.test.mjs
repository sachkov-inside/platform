// @ts-check
import assert from "node:assert/strict";
import test from "node:test";
import {
  checkModel,
  initialPayment,
  stepPayment,
  replayPayment,
} from "./pilots/payment-access-model.mjs";

test("bounded payment model closes without a safety or fair-progress counterexample", () => {
  const report = checkModel();
  assert.equal(report.counterexample, null);
  assert.equal(report.complete, true);
  assert.ok(report.states > 1);
  assert.ok(report.progressChecks > 0);
});

test("unknown-grant fault produces the shortest replayable counterexample", () => {
  const report = checkModel((state, event) =>
    event === "fulfill" && state.phase === "unknown"
      ? { ...state, issued: true, issueCount: state.issueCount + 1 }
      : stepPayment(state, event),
  );
  assert.equal(report.counterexample?.rule, "capture_before_access");
  assert.deepEqual(report.counterexample?.trace, [
    "command",
    "dispatch",
    "fulfill",
  ]);
});

test("duplicate-grant fault is rejected", () => {
  const report = checkModel((state, event) =>
    event === "fulfill" && state.observedCapture
      ? { ...state, issued: true, issueCount: state.issueCount + 1 }
      : stepPayment(state, event),
  );
  assert.equal(report.counterexample?.rule, "one_access_issuance");
});

test("refund proves capture and never automatically revokes; owner withdrawal survives replay", () => {
  const paid = replayPayment([
    "command",
    "dispatch",
    "bank_captures",
    "bank_refunds",
    "callback",
    "fulfill",
  ]);
  assert.equal(paid.issued, true);
  assert.equal(paid.revoked, false);
  const revoked = replayPayment(["owner_revoke", "callback", "fulfill"], paid);
  assert.equal(revoked.revoked, true);
  assert.equal(revoked.issueCount, 1);
});

test("retirement before Init survives repeated command and dispatch without sending", () => {
  const retired = replayPayment([
    "command",
    "retire",
    "command",
    "dispatch",
    "poll",
    "fulfill",
  ]);
  assert.equal(retired.initCount, 0);
  assert.equal(retired.issueCount, 0);
  assert.equal(retired.purchaseCount, 1);
  assert.equal(initialPayment().phase, "absent");
});

test("missing fulfillment violates progress under the explicit fair schedule", () => {
  const report = checkModel((state, event) =>
    event === "fulfill" ? state : stepPayment(state, event),
  );
  assert.equal(
    report.counterexample?.rule,
    "eventual_access_under_fair_recovery",
  );
});

test("automatic refund revocation is rejected", () => {
  const report = checkModel((state, event) =>
    event === "bank_refunds" && state.issued
      ? { ...stepPayment(state, event), revoked: true }
      : stepPayment(state, event),
  );
  assert.equal(report.counterexample?.rule, "only_owner_revokes");
});
