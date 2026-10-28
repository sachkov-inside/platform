// @ts-check
import assert from "node:assert/strict";
import { test } from "node:test";
import { phaseTiming } from "./phase-timing.mjs";

test("phase timing records numeric HTTP and complete observer windows against one anchor", () => {
  const timing = phaseTiming(5, 0, 1000, 1800000000000, 1001);
  timing.request(6, 6, 1010, 1025);
  timing.observer(0, 1002, 1040, undefined);
  timing.observer(1, 1540, 1550, "source_cache_response");
  timing.finish(2000, 1800000001000, 2001);
  assert.deepEqual(timing.result, {
    phase: 5,
    pair: 0,
    phase_start: [1000, 1800000000000, 1001],
    phase_end: [2000, 1800000001000, 2001],
    state: "complete",
    requests: [[6, 6, 10, 25]],
    observer_rounds: [
      [0, 2, 40, 0],
      [1, 540, 550, 9],
    ],
    request_overflow: 0,
    observer_overflow: 0,
    invalid_rows: 0,
  });
});

test("timing bounds retain the first rows and expose overflow without accepting raw values", () => {
  const timing = phaseTiming(11, 1, 1000, 1800000000000, 1001);
  for (let index = 0; index < 401; index++)
    timing.request(index % 400, 0, 1000, 1001);
  for (let index = 0; index < 129; index++)
    timing.observer(index, 1000, 1001, "metrics_http");
  assert.equal(timing.result.requests.length, 400);
  assert.equal(timing.result.observer_rounds.length, 128);
  assert.equal(timing.result.request_overflow, 1);
  assert.equal(timing.result.observer_overflow, 1);
  assert.ok(
    Buffer.byteLength(
      JSON.stringify({ load: { timing_diagnostics: timing.result } }, null, 2),
    ) < 100000,
  );
  timing.finish(2000, 1800000001000, 2001);
  assert.equal(timing.result.state, "overflow");
  const invalid = phaseTiming(0, 0, 1000, 1800000000000, 1001);
  /** @type {[number, number, number, number][]} */ const badWindows = [
    [-1, 0, 1000, 1001],
    [400, 0, 1000, 1001],
    [0.5, 0, 1000, 1001],
    [0, 4, 1000, 1001],
    [0, 0, NaN, 1001],
    [0, 0, 1000, Infinity],
    [0, 0, 999, 1001],
    [0, 0, 1001, 1000],
    [0, 0, 1000, 601001],
  ];
  for (const [index, kind, start, end] of badWindows)
    invalid.request(index, kind, start, end);
  invalid.observer(
    0,
    1000,
    1001,
    "https://private.invalid/?key=private-sentinel",
  );
  invalid.observer(-1, 1000, 1001, undefined);
  invalid.observer(0, 1001, 1000, undefined);
  assert.equal(invalid.result.invalid_rows, 12);
  invalid.finish(2000, 1800000001000, 2001);
  assert.equal(invalid.result.state, "invalid");
  assert.deepEqual(invalid.result.requests, []);
  assert.deepEqual(invalid.result.observer_rounds, []);
  assert.equal(JSON.stringify(invalid.result).includes("private"), false);
});

test("invalid clock or phase metadata stays explicitly unavailable", () => {
  const timing = phaseTiming(12, 2, NaN, Infinity, 0);
  timing.request(0, 0, 0, 1);
  timing.finish(0, 0, -1);
  assert.equal(timing.result.state, "invalid");
  assert.equal(timing.result.phase, null);
  assert.equal(timing.result.pair, null);
  assert.equal(timing.result.phase_start, null);
  assert.equal(timing.result.phase_end, null);
  assert.ok(timing.result.invalid_rows > 0);
});
