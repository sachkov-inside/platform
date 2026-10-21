// @ts-check
import assert from "node:assert/strict";
import { test } from "node:test";
import { runOwnedProcess } from "./observability-umami/process-owner.mjs";
import { fileURLToPath } from "node:url";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import {
  sourceIds,
  sourceProgress,
  assertResourceContracts,
  resourceTimingSummary,
} from "./observability-resource/source-progress.mjs";

/** Synthetic source callbacks only; this fixture never runs the real item84 modes. */
function timingWire() {
  const lines = ["RESOURCE_TIMING_V1 begin runner 0\n"];
  for (let index = 0; index < sourceIds.length; index += 1) {
    const id = sourceIds[index];
    lines.push(`RESOURCE_SOURCE_V1 start ${id}\n`);
    if (index === 83) {
      lines.push("RESOURCE_TIMING_V1 begin item84 100\n");
      for (const [modeIndex, mode] of [
        "success",
        "failure",
        "timeout",
        "sigterm",
        "sigkill",
        "descendant",
      ].entries()) {
        lines.push(
          `RESOURCE_TIMING_V1 begin ${mode} ${110 + modeIndex * 20}\n`,
        );
        lines.push(`RESOURCE_TIMING_V1 end ${mode} ${120 + modeIndex * 20}\n`);
      }
    }
    lines.push(`RESOURCE_SOURCE_V1 completed ${id}\n`);
    if (index === 83) lines.push("RESOURCE_TIMING_V1 end item84 230\n");
  }
  lines.push("RESOURCE_TIMING_V1 end runner 240\n");
  return lines;
}

// deterministic-test-allow unit-io: external owner bounds the complete Node helper contract group, including failed startup and lingering socket/timer regressions.
test("resource HTTP and identity contracts retain bounded process lifetime", async () => {
  const result = await runOwnedProcess("/usr/bin/env", [
    "-u",
    "NODE_TEST_CONTEXT",
    process.execPath,
    "--test",
    "--test-reporter=tap",
    fileURLToPath(
      new URL("./observability-resource/test-client.mjs", import.meta.url),
    ),
  ]);
  assert.equal(result.reason, "exit", result.stderr);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /# tests [1-9][0-9]*\b/u);
});

// deterministic-test-allow unit-io: external Node owner bounds the stdlib Python resource contracts and their owned process/Unix-socket fixtures.
test("resource manifest, counters and lifecycle retain bounded ownership and UNKNOWN semantics", async () => {
  const timed =
    process.env["CI"] === "true" &&
    process.env["GITHUB_EVENT_NAME"] === "pull_request";
  const result = timed
    ? await runOwnedProcess("/usr/bin/env", [
        "RESOURCE_TEST_TIMING_V1=1",
        "python3",
        "-B",
        "scripts/observability-resource/source_runner.py",
      ])
    : await runOwnedProcess("python3", [
        "-B",
        "scripts/observability-resource/source_runner.py",
      ]);
  if (timed) {
    const summary = resourceTimingSummary(result);
    assertResourceContracts(result, summary);
  } else assertResourceContracts(result);
});

// deterministic-test-allow unit-io: the external owner bounds the actual backend config/JWT/schema contract and its private HTTPS/HTTP loopback fixtures.
test("resource corpus meets the real API identity and account response contracts", async () => {
  const result = await runOwnedProcess("/usr/bin/env", [
    "-u",
    "NODE_TEST_CONTEXT",
    process.execPath,
    "apps/backend/node_modules/tsx/dist/cli.mjs",
    "--tsconfig",
    "apps/backend/tsconfig.json",
    "--test",
    "--test-reporter=tap",
    "apps/backend/scripts/resource-corpus-contract.test.mjs",
  ]);
  assert.equal(result.reason, "exit", result.stderr);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /# tests [1-9][0-9]*\b/u);
});

test("resource source progress projects canonical complete and active ordered prefixes", () => {
  const first = sourceIds[0],
    second = sourceIds[1];
  assert.ok(first !== undefined && second !== undefined);
  const start = `RESOURCE_SOURCE_V1 start ${first}\n`;
  const done = `RESOURCE_SOURCE_V1 completed ${first}\n`;
  assert.deepEqual(sourceProgress(start), {
    lastStarted: first,
    lastCompleted: null,
    completedCount: 0,
  });
  assert.deepEqual(sourceProgress(start + done), {
    lastStarted: first,
    lastCompleted: first,
    completedCount: 1,
  });
  assert.deepEqual(
    sourceProgress(start + done + `RESOURCE_SOURCE_V1 start ${second}\n`),
    { lastStarted: second, lastCompleted: first, completedCount: 1 },
  );
  const complete = sourceIds
    .map(
      (id) =>
        `RESOURCE_SOURCE_V1 start ${id}\nRESOURCE_SOURCE_V1 completed ${id}\n`,
    )
    .join("");
  assert.equal(sourceIds.length, 112);
  assert.equal(Buffer.byteLength(complete), 28022);
  assert.equal(sourceProgress(complete)?.completedCount, 112);
  const raw = timingWire().join("");
  assert.equal(
    resourceTimingSummary({ reason: "exit", stderr: raw }),
    "Resource timing: state=complete; before84_ns=100; success_ns=10; failure_ns=10; timeout_ns=10; sigterm_ns=10; sigkill_ns=10; descendant_ns=10; item84_ns=130; runner_ns=240",
  );
  assert.deepEqual(sourceProgress(raw), sourceProgress(complete));
  const lines = timingWire();
  for (const [index, line] of lines.entries()) {
    if (!line.startsWith("RESOURCE_TIMING") || index === lines.length - 1)
      continue;
    assert.match(
      resourceTimingSummary({
        reason: "timeout",
        stderr: lines.slice(0, index + 1).join(""),
      }),
      /^Resource timing: state=partial;/u,
    );
  }
  const stop = lines.indexOf("RESOURCE_TIMING_V1 begin failure 130\n");
  const completed84 = lines.indexOf(
    `RESOURCE_SOURCE_V1 completed ${sourceIds[83]}\n`,
  );
  const early = [...lines.slice(0, stop + 1), ...lines.slice(completed84)].join(
    "",
  );
  const earlySummary = resourceTimingSummary({ reason: "exit", stderr: early });
  assert.match(
    earlySummary,
    /state=partial; before84_ns=100; success_ns=10; failure_ns=unknown/u,
  );
  assert.match(earlySummary, /runner_ns=240$/u);
  const stopped = lines
    .filter((line) => !line.startsWith("RESOURCE_TIMING") || line === lines[0])
    .join("");
  assert.match(
    resourceTimingSummary({ reason: "exit", stderr: stopped }),
    /state=partial; before84_ns=unknown/u,
  );
});

test("resource source progress refuses malformed private duplicate truncated and oversized metadata", () => {
  const first = sourceIds[0],
    second = sourceIds[1];
  assert.ok(first !== undefined && second !== undefined);
  const start = `RESOURCE_SOURCE_V1 start ${first}\n`,
    done = `RESOURCE_SOURCE_V1 completed ${first}\n`;
  const complete = sourceIds
    .map(
      (id) =>
        `RESOURCE_SOURCE_V1 start ${id}\nRESOURCE_SOURCE_V1 completed ${id}\n`,
    )
    .join("");
  const invalid = [
    "",
    "legacy private-canary\n",
    start.slice(0, -1),
    start + "RESOURCE_SOURCE_V1 compl",
    done,
    start + start,
    start + done + done,
    start + done + start,
    `RESOURCE_SOURCE_V1 start ${second}\n`,
    start + `RESOURCE_SOURCE_V1 completed ${second}\n`,
    start.replace("V1", "V2"),
    start.replace("start", "unknown"),
    start.replace(first, "private-id"),
    "private-prefix " + start,
    start.replace("\n", "\r\n"),
    start.replace("start ", "start  "),
    start.replace("\n", " private-canary\n"),
    start + "RESOURCE_SOURCE_bad-private\n",
    complete + start,
    start + "RESOURCE_SOURCE" + "x".repeat(32768) + "\n",
    start + "x".repeat(1_048_576),
    start + "é".repeat(524288),
  ];
  for (const raw of invalid) assert.equal(sourceProgress(raw), null);
  const wire = timingWire().join("");
  const unknown = "Resource timing: unknown";
  const invalidTiming = [
    "",
    "private-noise",
    wire + "RESOURCE_TIMING_V1 end runner 250\n",
    wire.replace("begin runner 0", "begin runner 00"),
    wire.replace("begin runner 0", "end runner 0"),
    wire.replace("begin item84 100", "begin item84 -1"),
    wire.replace("begin item84 100", "begin item84 true"),
    wire.replace("begin item84 100", "begin item84 60000000001"),
    wire.replace("begin item84 100", "begin item84 1e2"),
    wire.replace("begin item84 100", "begin item84 100.0"),
    wire.replace("begin item84 100", "begin item84 １００"),
    wire.replace("end success 120", "end success 109"),
    wire.replace("begin failure 130", "begin private-slot 130"),
    wire.replace("begin failure 130", "unknown failure 130"),
    wire.replace(
      "RESOURCE_TIMING_V1 begin failure 130\n",
      "RESOURCE_TIMING_V1 begin failure 130\r\n",
    ),
    wire.replace("RESOURCE_TIMING_V1 end success 120\n", ""),
    wire.replace("RESOURCE_TIMING_V1 begin success 110\n", ""),
    wire.replace(
      "RESOURCE_TIMING_V1 begin runner 0\n",
      "RESOURCE_TIMING_V2 begin runner 0\n",
    ),
    wire.slice(0, -1),
    wire + "RESOURCE_TIMING" + "x".repeat(2048) + "\n",
    wire + "x".repeat(1_048_576),
    wire.replace("RESOURCE_SOURCE_V1 start", "RESOURCE_SOURCE_V2 start"),
  ];
  // Keep old source order valid while violating the timing/source cross-state.
  for (const [marker, anchor] of [
    [
      "RESOURCE_TIMING_V1 begin runner 0\n",
      `RESOURCE_SOURCE_V1 start ${sourceIds[0]}\n`,
    ],
    [
      "RESOURCE_TIMING_V1 begin item84 100\n",
      `RESOURCE_SOURCE_V1 start ${sourceIds[83]}\n`,
    ],
    [
      "RESOURCE_TIMING_V1 end item84 230\n",
      `RESOURCE_SOURCE_V1 completed ${sourceIds[83]}\n`,
    ],
    [
      "RESOURCE_TIMING_V1 end runner 240\n",
      `RESOURCE_SOURCE_V1 completed ${sourceIds[111]}\n`,
    ],
  ]) {
    assert.ok(marker !== undefined && anchor !== undefined);
    const removed = wire.replace(marker, "");
    invalidTiming.push(
      removed.replace(
        anchor,
        marker.startsWith("RESOURCE_TIMING_V1 begin runner")
          ? anchor + marker
          : marker + anchor,
      ),
    );
  }
  for (const stderr of invalidTiming)
    assert.equal(resourceTimingSummary({ reason: "exit", stderr }), unknown);
  let accesses = 0;
  const privateGetter = {
    reason: "exit",
    get stderr() {
      accesses += 1;
      throw Error("private-stderr");
    },
  };
  const privateReason = {
    get reason() {
      accesses += 1;
      throw Error("private-reason");
    },
    stderr: wire,
  };
  const proxy = new Proxy(
    {},
    {
      getOwnPropertyDescriptor() {
        accesses += 1;
        throw Error("private-proxy");
      },
    },
  );
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  for (const input of [
    null,
    undefined,
    1,
    [],
    new String(wire),
    Object.create({ reason: "exit", stderr: wire }),
    privateGetter,
    privateReason,
    proxy,
    revoked.proxy,
    { reason: "unknown", stderr: wire },
  ])
    assert.equal(resourceTimingSummary(input), unknown);
  assert.equal(accesses, 0);
  // Prove the output-limit branch returns before even inspecting a stderr descriptor.
  const limited = { reason: "output_limit", stderr: wire };
  const descriptor = Object.getOwnPropertyDescriptor;
  let stderrDescriptors = 0;
  try {
    // deterministic-test-allow shared-mutation: synchronous descriptor sentinel is restored by finally before this pure callback returns.
    Object.getOwnPropertyDescriptor = (value, key) => {
      if (value === limited && key === "stderr") {
        stderrDescriptors += 1;
        throw Error("private-descriptor");
      }
      return descriptor(value, key);
    };
    assert.equal(resourceTimingSummary(limited), unknown);
  } finally {
    Object.getOwnPropertyDescriptor = descriptor;
  }
  assert.equal(stderrDescriptors, 0);
  const hostile = {
    get stderr() {
      throw new Error("private-getter");
    },
    toString() {
      throw new Error("private-coercion");
    },
  };
  for (const raw of [undefined, null, hostile, 1, [], new String(start)])
    assert.equal(sourceProgress(raw), null);
  assert.deepEqual(
    sourceProgress(start + "x".repeat(1_048_576 - Buffer.byteLength(start))),
    { lastStarted: first, lastCompleted: null, completedCount: 0 },
  );
});

test("resource source assertions preserve failures without publishing captured private output", () => {
  const prefix = `RESOURCE_SOURCE_V1 start ${sourceIds[0]}\n`;
  for (const summary of [
    resourceTimingSummary({ reason: "exit", stderr: timingWire().join("") }),
    "private-summary",
    {
      toString() {
        throw Error("private-coercion");
      },
    },
  ]) {
    const result = {
      code: 7,
      signal: null,
      pid: undefined,
      reason: /** @type {const} */ ("exit"),
      stdout: "private-stdout",
      stderr: prefix,
    };
    assert.throws(
      () => assertResourceContracts(result, summary),
      (error) => {
        assert.ok(error instanceof assert.AssertionError);
        assert.equal(error.actual, 7);
        assert.equal(error.expected, 0);
        assert.doesNotMatch(error.message, /private-/u);
        assert.match(
          error.message,
          /Resource timing: (state=complete|unknown)/u,
        );
        return true;
      },
    );
  }
  /** @type {("timeout" | "interrupted" | "output_limit" | "exit")[]} */
  const reasons = ["timeout", "interrupted", "output_limit", "exit"];
  for (const reason of reasons)
    for (const stderr of [
      "",
      "private-auth-canary\n",
      prefix,
      prefix + "private-auth-canary\n",
      prefix + "RESOURCE_SOURCE_bad-private\n",
    ]) {
      const result = {
        code: reason === "exit" ? 3 : null,
        signal: null,
        pid: undefined,
        reason,
        stdout: "private-stdout-canary",
        stderr,
      };
      assert.throws(
        () => assertResourceContracts(result),
        (error) => {
          assert.ok(error instanceof assert.AssertionError);
          assert.equal(error.actual, reason === "exit" ? 3 : reason);
          assert.equal(error.expected, reason === "exit" ? 0 : "exit");
          assert.doesNotMatch(error.message, /private-/u);
          assert.doesNotMatch(error.stack ?? "", /private-/u);
          assert.match(
            error.message,
            reason !== "output_limit" &&
              (stderr === prefix || stderr === prefix + "private-auth-canary\n")
              ? /lastStarted=/u
              : /unknown/u,
          );
          return true;
        },
      );
    }
  assert.throws(
    () =>
      assertResourceContracts({
        code: null,
        signal: null,
        pid: undefined,
        reason: "output_limit",
        stdout: "private-stdout",
        /** @returns {string} */
        get stderr() {
          throw new Error("private-stderr-getter");
        },
      }),
    (error) =>
      error instanceof assert.AssertionError &&
      error.actual === "output_limit" &&
      /unknown/u.test(error.message) &&
      !/private-/u.test(error.message),
  );
  for (const stderr of [
    "",
    "private-legacy",
    prefix,
    prefix + "RESOURCE_SOURCE_bad-private\n",
  ])
    assertResourceContracts({
      code: 0,
      signal: null,
      pid: undefined,
      reason: "exit",
      stdout: "private-stdout",
      stderr,
    });
});

// deterministic-test-allow unit-io: one test-owned Python listener uses the unchanged external owner and fixed700ms timeout; readiness does not extend its process lifetime.
test("resource acquired-listener timeout retains closed progress and reaps its owned group", async () => {
  for (const emit of [true, false]) {
    const directory = await mkdtemp(
      join(tmpdir(), "inside-resource-progress-"),
    );
    const report = join(directory, "owner.json");
    const script = `import json,os,socket,signal,sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path.cwd()/"scripts/observability-resource"))
import source_progress
class Controlled(unittest.TestCase):
    def id(self):return source_progress.SOURCE_IDS[0]
    def runTest(self):
        with socket.socket() as listener:
            listener.bind(('127.0.0.1',0));listener.listen(1)
            value={'pid':os.getpid(),'port':listener.getsockname()[1]}
            temporary=sys.argv[1]+'.new'
            with open(temporary,'x') as stream:json.dump(value,stream)
            os.replace(temporary,sys.argv[1])
            signal.pause()
unittest.TextTestRunner(stream=sys.stderr,verbosity=0,resultclass=${emit ? "source_progress.ProgressResult" : "unittest.TextTestResult"}).run(unittest.TestSuite([Controlled()]))
`;
    const pending = runOwnedProcess("python3", ["-B", "-c", script, report], {
      timeoutMs: 700,
      terminateGraceMs: 250,
      cleanupBudgetMs: 3000,
    });
    let settled = false,
      failed = false;
    void pending.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    try {
      const deadline = performance.now() + 4000;
      let raw;
      while (raw === undefined) {
        try {
          raw = await readFile(report, "utf8");
        } catch (error) {
          if (
            !(error instanceof Error) ||
            !("code" in error) ||
            error.code !== "ENOENT"
          )
            throw error;
          assert.ok(
            !settled && performance.now() < deadline,
            "closed fixture acquisition deadline",
          );
          // deterministic-test-allow duration-wait: poll this fixture's atomic listener report; owner timeout remains700ms regardless of the four-second readiness bound.
          await delay(10);
        }
      }
      assert.ok(Buffer.byteLength(raw) <= 4096, "closed fixture report size");
      assert.ok(
        /^\{"pid": [1-9][0-9]{0,9}, "port": [1-9][0-9]{0,4}\}$/u.test(raw),
        "closed fixture report grammar",
      );
      /** @type {unknown} */
      const state = JSON.parse(raw);
      assert.ok(typeof state === "object" && state !== null);
      /** @param {"pid"|"port"} key */
      const integer = (key) => {
        /** @type {unknown} */
        const value = Reflect.get(state, key);
        assert.ok(
          typeof value === "number" &&
            Number.isSafeInteger(value) &&
            value > 1 &&
            value <= 2 ** 31 - 1,
          "closed fixture field",
        );
        return value;
      };
      const pid = integer("pid"),
        port = integer("port");
      assert.ok(port <= 65535, "closed fixture port");
      const result = await pending;
      assert.equal(pid, result.pid, "closed fixture owned process identity");
      assert.equal(result.reason, "timeout");
      assert.deepEqual(
        sourceProgress(result.stderr),
        emit
          ? {
              lastStarted: sourceIds[0],
              lastCompleted: null,
              completedCount: 0,
            }
          : null,
      );
      assert.throws(
        () => assertResourceContracts(result),
        (error) =>
          error instanceof assert.AssertionError &&
          error.actual === "timeout" &&
          !/private-/u.test(error.message),
      );
      assert.throws(
        () => process.kill(pid, 0),
        (error) =>
          error instanceof Error && "code" in error && error.code === "ESRCH",
      );
      const listener = createServer();
      try {
        await new Promise((resolve, reject) => {
          listener.once("error", reject);
          listener.listen(port, "127.0.0.1", () => resolve(undefined));
        });
      } finally {
        if (listener.listening)
          await new Promise((resolve) =>
            listener.close(() => resolve(undefined)),
          );
      }
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      await pending.catch(() => undefined);
      await rm(directory, { recursive: true, force: true }).catch((error) => {
        if (!failed) throw error;
      });
    }
  }
});
