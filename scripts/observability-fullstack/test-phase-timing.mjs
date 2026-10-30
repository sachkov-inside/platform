// @ts-check
import assert from "node:assert/strict";
import { test } from "node:test";
import { EventEmitter } from "node:events";
import { PerformanceObserver, constants } from "node:perf_hooks";
import { phaseTiming, slotOccupancy } from "./phase-timing.mjs";

/** @param {number} startTime @param {number} duration @param {unknown} [kind] */
function gcEntry(
  startTime,
  duration,
  kind = constants.NODE_PERFORMANCE_GC_MINOR,
) {
  return {
    entryType: /** @type {const} */ ("gc"),
    name: "private-token-url-account-sentinel",
    startTime,
    duration,
    detail: { kind },
    toJSON: () => ({ private: "sentinel" }),
  };
}
function gcBoundary() {
  /** @type {string[]} */ const calls = [];
  /** @type {import('node:perf_hooks').PerformanceEntry[]} */ const pending =
    [];
  /** @type {(entries:import('node:perf_hooks').PerformanceEntry[])=>void} */ let deliver =
    () => {};
  class Observer extends PerformanceObserver {
    /** @param {import('node:perf_hooks').PerformanceObserverCallback} callback */
    constructor(callback) {
      super(callback);
      deliver = (entries) =>
        callback(
          {
            getEntries: () => entries,
            getEntriesByName: () => [],
            getEntriesByType: () => [],
          },
          this,
        );
    }
    /** @override */ observe() {
      calls.push("observe");
    }
    /** @override */ takeRecords() {
      calls.push("drain");
      return pending.splice(0);
    }
    /** @override */ disconnect() {
      calls.push("disconnect");
    }
  }
  return {
    Observer,
    calls,
    pending,
    deliver: (
      /** @type {import('node:perf_hooks').PerformanceEntry[]} */ entries,
    ) => deliver(entries),
  };
}

test("six-lane transport separates body and decode on the original clock", (t) => {
  let now = 1000;
  t.mock.method(performance, "now", () => now);
  const timing = phaseTiming(2, 0, 1000, 1800000000000, 1000);
  const socket = new EventEmitter(),
    req = Object.assign(new EventEmitter(), { socket });
  const observer = timing.requestTransport(2, 2);
  assert.ok(observer);
  observer.begin(1000);
  observer.attach(req);
  now = 1001;
  observer.submitted();
  now = 1002;
  req.emit("socket");
  now = 1003;
  socket.emit("connect");
  now = 1004;
  socket.emit("secureConnect");
  now = 1005;
  req.emit("finish");
  now = 1006;
  observer.headers();
  now = 1007;
  observer.bodyEnd();
  now = 1008;
  observer.decoded();
  observer.finish(1009, 0);
  assert.deepEqual(timing.result.request_transport, {
    schema: 1,
    width: 13,
    state: "complete",
    rows: [2, 2, 0, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 0],
    overflow: 0,
    invalid: 0,
  });
  assert.equal("web_transport" in timing.result, false);
});

test("client work retains numeric overlap and propagates the original action failure", (t) => {
  let now = 1000;
  t.mock.method(performance, "now", () => now);
  const timing = phaseTiming(2, 0, 1000, 1800000000000, 1000);
  const original = new Error("private-token-url-account-sentinel");
  assert.equal(
    timing.work(0, () => {
      now = 1001;
      return 42;
    }),
    42,
  );
  assert.throws(
    () =>
      timing.work(1, () => {
        now = 1002;
        throw original;
      }),
    (error) => error === original,
  );
  assert.deepEqual(timing.result.client_work, {
    schema: 1,
    width: 4,
    state: "observed",
    rows: [0, 0, 1000, 0, 1, 1000, 2000, 1],
    overflow: 0,
    invalid: 0,
  });
  assert.equal(JSON.stringify(timing.result).includes("private"), false);
});

test("GC drains delivered entries on the phase clock and always leaves tail coverage unknown", (t) => {
  let now = 1000;
  t.mock.method(performance, "now", () => now);
  /** @type {string[]} */ const calls = [];
  class Observer extends PerformanceObserver {
    /** @override */ observe() {
      calls.push("observe");
    }
    /** @override */ takeRecords() {
      calls.push("drain");
      return [
        Object.assign(
          {
            entryType: /** @type {const} */ ("gc"),
            name: "private-sentinel",
            startTime: 1001,
            duration: 2,
            toJSON: () => ({}),
          },
          { detail: { kind: constants.NODE_PERFORMANCE_GC_MINOR } },
        ),
      ];
    }
    /** @override */ disconnect() {
      calls.push("disconnect");
    }
  }
  const timing = phaseTiming(2, 0, 1000, 1800000000000, 1000);
  timing.startGc(Observer);
  now = 1004;
  timing.finish(1004, 1800000000004, 1004);
  timing.stopClient();
  timing.stopClient();
  assert.deepEqual(calls, ["observe", "drain", "disconnect"]);
  assert.deepEqual(timing.result.client_gc, {
    schema: 1,
    width: 3,
    state: "observed",
    capture_start_us: 0,
    capture_end_us: 4000,
    tail_complete: false,
    rows: [1, 1000, 3000],
    overflow: 0,
    invalid: 0,
    excluded: 0,
  });
});

test("GC crossing the final raw boundary is unavailable even when microseconds collapse", (t) => {
  t.mock.method(performance, "now", () => 1000);
  const timing = phaseTiming(2, 0, 1000, 1800000000000, 1000),
    boundary = gcBoundary();
  timing.startGc(boundary.Observer);
  boundary.deliver([gcEntry(1000, 0.0009)]);
  timing.finish(1000.0008, 1800000000000, 1000.0008);
  timing.stopClient();
  assert.equal(timing.result.client_gc?.state, "unavailable");
  assert.ok((timing.result.client_gc?.invalid ?? 0) > 0);
});

test("plain transport omits TLS while legacy Web keeps unquantized milliseconds", (t) => {
  let now = 1000;
  t.mock.method(performance, "now", () => now);
  const timing = phaseTiming(2, 0, 1000, 1800000000000, 1000);
  for (const kind of [0, 1, 2, 3, 6, 7]) {
    const socket = new EventEmitter(),
      req = Object.assign(new EventEmitter(), { socket });
    const observer = timing.requestTransport(kind, kind);
    assert.ok(observer);
    observer.begin(1000);
    observer.attach(req);
    now = 1001.000123;
    observer.submitted();
    now = 1002;
    req.emit("socket");
    now = 1003;
    socket.emit("connect");
    if (kind < 6) {
      now = 1004;
      socket.emit("secureConnect");
    }
    now = 1005;
    req.emit("finish");
    now = 1006;
    observer.headers();
    now = 1007;
    observer.bodyEnd();
    now = 1008;
    observer.decoded();
    observer.finish(1009, 0);
    assert.equal(socket.listenerCount("secureConnect"), 0);
    assert.equal(req.listenerCount("socket"), 0);
  }
  assert.equal(timing.result.request_transport?.state, "complete");
  assert.equal(timing.result.request_transport?.rows.length, 78);
  assert.equal(timing.result.request_transport?.rows[4 * 13 + 6], null);
  assert.equal(timing.result.web_transport?.state, "complete");
  assert.equal(timing.result.web_transport?.rows[0]?.[3], 1001.000123 - 1000);
  assert.equal(timing.result.request_transport?.rows[3], 1000);
});

test("additive hook faults preserve the existing Web transport verdict", (t) => {
  let now = 1000;
  t.mock.method(performance, "now", () => now);
  const timing = phaseTiming(2, 0, 1000, 1800000000000, 1000);
  const socket = new EventEmitter(),
    req = Object.assign(new EventEmitter(), { socket });
  const observer = timing.requestTransport(0, 0);
  assert.ok(observer);
  observer.begin(1000);
  observer.attach(req);
  now = 1001;
  observer.submitted();
  now = 1002;
  req.emit("socket");
  now = 1003;
  socket.emit("connect");
  now = 1004;
  socket.emit("secureConnect");
  now = 1005;
  req.emit("finish");
  now = 1006;
  observer.headers();
  now = 1007;
  observer.bodyEnd();
  now = 1008;
  observer.decoded();
  observer.finish(1009, 0, true);
  assert.equal(timing.result.web_transport?.state, "complete");
  assert.equal(timing.result.web_transport?.rows[0]?.[10], 0);
  assert.equal(timing.result.request_transport?.state, "partial");
  assert.equal(timing.result.request_transport?.rows[12], 5);
});

test("raw clocks fail closed before quantization and settled observers stop reading clocks", (t) => {
  let now = 1000.0009,
    reads = 0;
  t.mock.method(performance, "now", () => {
    reads++;
    return now;
  });
  const timing = phaseTiming(2, 0, 1000, 1800000000000, 1000);
  timing.work(0, () => {
    now = 1000.0008;
  });
  assert.equal(timing.result.client_work?.state, "unavailable");
  assert.deepEqual(timing.result.client_work?.rows, []);
  const observer = timing.requestTransport(2, 2);
  assert.ok(observer);
  observer.begin(1000.0009);
  observer.submitted();
  observer.finish(1001, 0);
  assert.equal(timing.result.request_transport?.state, "partial");
  assert.equal(timing.result.request_transport?.rows[12], 5);
  const snapshot = JSON.stringify(timing.result),
    before = reads;
  observer.submitted();
  observer.headers();
  observer.bodyEnd();
  observer.decoded();
  observer.finish(1002, 0);
  assert.equal(reads, before);
  assert.equal(JSON.stringify(timing.result), snapshot);
  for (const bad of [NaN, Infinity, 999, 601001]) {
    now = bad;
    const error = new Error("private-token-sentinel");
    assert.throws(
      () =>
        timing.work(1, () => {
          throw error;
        }),
      (caught) => caught === error,
    );
  }
  assert.equal(JSON.stringify(timing.result).includes("private"), false);
});

test("diagnostic caps retain first rows and saturation stays explicitly unknown", (t) => {
  t.mock.method(performance, "now", () => 1000);
  const timing = phaseTiming(2, 0, 1000, 1800000000000, 1000),
    boundary = gcBoundary();
  let actions = 0;
  for (let i = 0; i < 4097; i++) timing.work(0, () => actions++);
  assert.equal(actions, 4097);
  assert.equal(timing.result.client_work?.rows.length, 16384);
  assert.equal(timing.result.client_work?.state, "overflow");
  assert.equal(timing.result.client_work?.overflow, 1);
  for (let ordinal = 0; ordinal < 400; ordinal++)
    if ([0, 1, 2, 3, 6, 7].includes(ordinal % 8)) {
      const observer = timing.requestTransport(ordinal, ordinal % 8);
      assert.ok(observer);
      observer.begin(1000);
      observer.finish(1001, 3);
    }
  assert.equal(timing.result.request_transport?.rows.length, 3900);
  assert.equal(timing.requestTransport(2, 2), undefined);
  assert.equal(timing.result.request_transport?.state, "overflow");
  assert.equal(timing.result.web_transport?.rows.length, 100);
  timing.startGc(boundary.Observer);
  boundary.deliver(Array.from({ length: 513 }, () => gcEntry(1000, 0)));
  assert.equal(timing.result.client_gc?.rows.length, 1536);
  assert.equal(timing.result.client_gc?.state, "overflow");
  assert.deepEqual(boundary.calls, ["observe", "disconnect"]);
  const snapshot = JSON.stringify(timing.result);
  boundary.deliver([gcEntry(1001, 1)]);
  timing.stopClient();
  assert.equal(JSON.stringify(timing.result), snapshot);
});

test("GC faults, unsupported observation and late delivery never imply zero GC", (t) => {
  let now = 1000;
  t.mock.method(performance, "now", () => now);
  for (const method of /** @type {const} */ ([
    "observe",
    "takeRecords",
    "disconnect",
  ])) {
    const timing = phaseTiming(2, 0, 1000, 1800000000000, 1000),
      boundary = gcBoundary();
    t.mock.method(boundary.Observer.prototype, method, () => {
      throw new Error("private-token-url-account-sentinel");
    });
    timing.startGc(boundary.Observer);
    now = 1004;
    timing.finish(1004, 1800000000004, 1004);
    timing.stopClient();
    assert.equal(timing.result.client_gc?.state, "unavailable");
    assert.equal(timing.result.client_gc?.tail_complete, false);
    assert.equal(JSON.stringify(timing.result).includes("private"), false);
    now = 1000;
  }
  const timing = phaseTiming(2, 0, 1000, 1800000000000, 1000),
    boundary = gcBoundary();
  Object.defineProperty(boundary.Observer, "supportedEntryTypes", {
    value: [],
  });
  timing.startGc(boundary.Observer);
  timing.stopClient();
  assert.equal(timing.result.client_gc?.state, "unavailable");
  assert.deepEqual(boundary.calls, []);
  const active = phaseTiming(2, 0, 1000, 1800000000000, 1000),
    feed = gcBoundary();
  now = 1001;
  active.startGc(feed.Observer);
  feed.deliver([
    gcEntry(1000, 0.5),
    gcEntry(1001, -1),
    gcEntry(1001, NaN),
    gcEntry(1001, 0, "private-token"),
  ]);
  now = 1004;
  active.finish(1004, 1800000000004, 1004);
  feed.deliver([gcEntry(1005, 0), gcEntry(1003, 2)]);
  active.stopClient();
  assert.equal(active.result.client_gc?.excluded, 2);
  assert.equal(active.result.client_gc?.invalid, 4);
  assert.equal(active.result.client_gc?.state, "unavailable");
  const snapshot = JSON.stringify(active.result);
  feed.deliver([gcEntry(1001, 1)]);
  assert.equal(JSON.stringify(active.result), snapshot);
  assert.equal(snapshot.includes("private"), false);
});

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

test("named primed control routes actual warmup400 at20rps and measurement400 at40rps", async () => {
  const { runStabilityPhase } = await import("./stability-protocol.mjs");
  /** @type {[import("./stability-protocol.mjs").Definition,boolean,number,number][]} */
  const calls = [];
  /** @param {import("./stability-protocol.mjs").Definition} definition @param {boolean} enabled @param {number} pair @param {number} ordinal */
  const load = async (definition, enabled, pair, ordinal) => {
    calls.push([definition, enabled, pair, ordinal]);
    return { completed: true };
  };
  for (const ordinal of [0, 1, 6, 7])
    await runStabilityPhase(
      [
        ordinal >= 6 ? "on" : "off",
        String(ordinal),
        "fixed-actor-primed400-v1",
      ],
      load,
    );
  assert.deepEqual(calls, [
    [{ name: "spike", seconds: 20, requests_per_second: 20 }, false, 0, 0],
    [{ name: "spike", seconds: 10, requests_per_second: 40 }, false, 0, 1],
    [{ name: "spike", seconds: 20, requests_per_second: 20 }, true, 1, 6],
    [{ name: "spike", seconds: 10, requests_per_second: 40 }, true, 1, 7],
  ]);
});

test("diagnostic dispatcher defaults to cold400 and refuses arbitrary or mixed phase controls", async () => {
  const { runStabilityPhase } = await import("./stability-protocol.mjs");
  const cold = await runStabilityPhase(["off", "0"], async (definition) => ({
    definition,
  }));
  assert.deepEqual(cold.diagnostic_definition, {
    name: "spike",
    seconds: 10,
    requests_per_second: 40,
  });
  assert.equal(cold.diagnostic_protocol, "fixed-actor-cold400-v1");
  for (const args of [
    ["off", "0", "private-knob"],
    ["on", "0", "fixed-actor-primed400-v1"],
    ["off", "6", "fixed-actor-primed400-v1"],
    ["off", "00"],
    ["off", "12"],
    ["off", "0", "fixed-actor-primed400-v1", "20"],
    ["off"],
  ])
    await assert.rejects(
      runStabilityPhase(args, async () => {
        assert.fail("invalid control reached load");
      }),
    );
});

test("Web transport keeps independent branches, missing events, private faults and owned listeners closed", (t) => {
  let now = 1000;
  t.mock.method(performance, "now", () => now);
  const timing = phaseTiming(2, 0, 1000, 1800000000000, 1001);
  const socket = new EventEmitter(),
    req = Object.assign(new EventEmitter(), { socket });
  let unrelated = 0;
  const listener = () => unrelated++;
  req.on("finish", listener);
  socket.on("connect", listener);
  const observe = timing.webRequest(0, 0);
  assert.ok(observe);
  observe.begin(1000);
  observe.attach(req);
  now = 1001;
  req.emit("socket", socket);
  now = 1002;
  socket.emit("connect");
  now = 1003;
  socket.emit("secureConnect");
  // Submission can follow socket/connect and finish is a separate branch.
  now = 1004;
  observe.submitted();
  now = 1005;
  req.emit("finish");
  now = 1006;
  observe.headers();
  observe.finish(1007, 0);
  assert.ok(timing.result.web_transport);
  assert.deepEqual(timing.result.web_transport.rows, [
    [0, 0, 0, 4, 1, 2, 3, 5, 6, 7, 0],
  ]);
  assert.equal(timing.result.web_transport.state, "complete");
  assert.equal(unrelated, 2);
  assert.deepEqual(req.listeners("finish"), [listener]);
  assert.deepEqual(socket.listeners("connect"), [listener]);
  assert.equal(socket.listenerCount("secureConnect"), 0);
  assert.equal(req.listenerCount("socket"), 0);
  const snapshot = JSON.stringify(timing.result);
  now = 2000;
  observe.headers();
  observe.finish(2001, 0);
  assert.equal(JSON.stringify(timing.result), snapshot);
  const absent = timing.webRequest(1, 1);
  assert.ok(absent);
  absent.begin(1008);
  absent.attach(req);
  absent.finish(1009, 1);
  assert.equal(timing.result.web_transport.state, "partial");
  assert.equal(timing.result.web_transport.rows[1]?.[5], null);
  assert.equal(req.listenerCount("socket"), 0);
  const repeated = timing.webRequest(8, 0);
  assert.ok(repeated);
  repeated.begin(1010);
  now = 1011;
  repeated.submitted();
  repeated.submitted();
  repeated.finish(1012, 0);
  assert.equal(timing.result.web_transport.rows[2]?.[10], 5);
  const broken = timing.webRequest(9, 1);
  assert.ok(broken);
  broken.begin(1013);
  const bad = new EventEmitter();
  bad.once = () => {
    throw new Error("private-token-url");
  };
  assert.doesNotThrow(() => broken.attach(bad));
  broken.finish(1014, 0);
  assert.equal(JSON.stringify(timing.result).includes("private"), false);
});

test("Web transport refuses invalid/duplicate/nonfinite input, bounds100 rows and preserves old phase contracts", (t) => {
  let now = 0;
  t.mock.method(performance, "now", () => now);
  const idle = phaseTiming(0, 0, 0, 1800000000000, 0);
  idle.finish(1, 1800000000001, 1);
  assert.equal("web_transport" in idle.result, false);
  const timing = phaseTiming(2, 0, 0, 1800000000000, 0);
  for (let i = 0; i < 100; i++) {
    const observer = timing.webRequest(Math.floor(i / 2) * 8 + (i % 2), i % 2);
    assert.ok(observer);
    observer.begin(0);
    observer.finish(1, 3);
  }
  assert.ok(timing.result.web_transport);
  assert.equal(timing.result.web_transport.rows.length, 100);
  assert.equal(timing.webRequest(0, 0), undefined);
  assert.equal(timing.result.web_transport.overflow, 1);
  assert.equal(timing.result.web_transport.state, "overflow");
  const duplicate = phaseTiming(2, 0, 0, 1800000000000, 0);
  duplicate.webRequest(0, 0);
  assert.equal(duplicate.webRequest(0, 0), undefined);
  assert.ok(duplicate.result.web_transport);
  assert.equal(duplicate.result.web_transport.state, "unavailable");
  /** @type {[number,number][]} */ const invalidInputs = [
    [-1, 0],
    [400, 0],
    [0, 2],
    [1, 0],
    [NaN, 0],
  ];
  for (const [ordinal, kind] of invalidInputs)
    assert.equal(timing.webRequest(ordinal, kind), undefined);
  assert.equal(timing.result.web_transport.state, "unavailable");
  const badClock = phaseTiming(2, 0, 0, 1800000000000, 0),
    o = badClock.webRequest(0, 0);
  assert.ok(o);
  o.begin(NaN);
  now = Infinity;
  o.submitted();
  o.finish(1, 0);
  assert.ok(badClock.result.web_transport);
  const badRow = badClock.result.web_transport.rows[0];
  assert.ok(badRow);
  assert.deepEqual(badRow.slice(2, 4), [null, null]);
  assert.equal(badRow[10], 5);
  assert.ok(Buffer.byteLength(JSON.stringify(timing.result)) < 100000);
});
