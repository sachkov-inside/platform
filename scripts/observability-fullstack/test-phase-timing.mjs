// @ts-check
import assert from "node:assert/strict";
import { test } from "node:test";
import { phaseTiming, slotOccupancy } from "./phase-timing.mjs";

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

test("first refusal preserves first eight real stages and stops diagnostic clocks", (t) => {
  let now = 0,
    reads = 0;
  t.mock.method(performance, "now", () => {
    reads++;
    return now;
  });
  const recorder = slotOccupancy(5, true, 0);
  const entries = [],
    work = [];
  for (let kind = 0; kind < 8; kind++) {
    now = kind * 25;
    const entry = recorder.acquire(kind);
    entries.push(entry);
    const promise = Promise.resolve();
    work.push(promise);
    recorder.attach(promise, entry);
  }
  now = 180;
  recorder.stage(entries[0], 1);
  now = 190;
  recorder.stage(entries[1], 2);
  now = 200;
  recorder.refuse();
  const result = structuredClone(recorder.result());
  assert.equal(result.state, "captured");
  assert.equal(result.decision_us, 200000);
  assert.deepEqual(result.slots?.[0], [0, 1, 0, 180000, 200000, 20000]);
  assert.deepEqual(result.slots?.[1], [1, 2, 25000, 190000, 175000, 10000]);
  assert.equal(result.slots?.length, 8);
  const before = reads;
  now = 500;
  recorder.stage(entries[2], 1);
  recorder.refuse();
  recorder.acquire(0);
  for (const promise of work) recorder.release(promise);
  assert.equal(reads, before);
  assert.deepEqual(recorder.result(), result);
  assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 2048);
});

test("first refusal clock errors and absent released slots are closed unavailable", (t) => {
  let now = 0;
  t.mock.method(performance, "now", () => {
    if (now === -1) throw new Error("private-token-url");
    return now;
  });
  for (const bad of [NaN, Infinity, -1, -2, 600001]) {
    now = bad;
    const recorder = slotOccupancy(0, false, 0);
    assert.doesNotThrow(() => recorder.acquire(0));
    assert.deepEqual(recorder.result(), {
      schema: 1,
      state: "unavailable",
      reason: "clock",
    });
  }
  now = 0;
  const recorder = slotOccupancy(0, false, 0),
    work = [];
  for (let kind = 0; kind < 8; kind++) {
    const promise = Promise.resolve();
    work.push(promise);
    recorder.attach(promise, recorder.acquire(kind));
  }
  assert.ok(work[0]);
  recorder.release(work[0]);
  recorder.refuse();
  assert.deepEqual(recorder.result(), {
    schema: 1,
    state: "unavailable",
    reason: "capture",
  });
  const backward = slotOccupancy(0, false, 0);
  now = 2;
  const entry = backward.acquire(0);
  now = 1;
  backward.stage(entry, 2);
  assert.deepEqual(backward.result(), {
    schema: 1,
    state: "unavailable",
    reason: "clock",
  });
  assert.equal(JSON.stringify(recorder.result()).includes("private"), false);
  assert.deepEqual(slotOccupancy(12, false, 0).result(), {
    schema: 1,
    state: "unavailable",
    reason: "bounds",
  });
});
