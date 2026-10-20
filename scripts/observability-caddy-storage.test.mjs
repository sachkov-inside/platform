// @ts-check
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { runOwnedProcess } from "./observability-umami/process-owner.mjs";
import * as contracts from "./observability-caddy-storage/contract-runner.mjs";

// deterministic-test-allow unit-io: pure bounded Caddy contracts and owned protocol fixtures, no Docker or external provider; outer owner reaps children on every outcome.
test("Caddy refuses invalid whole observations and owns protocol children", async () => {
  const result = await contracts.runCaddyContracts([]);
  contracts.assertCaddyContracts(result);
});

test("Caddy source progress projects only a canonical active source test", () => {
  const id =
    "test_accounting.PartitionAccounting.test_read_queries_are_counted_and_a_scrape_inside_a_request_window_is_ambiguous";
  assert.deepEqual(
    contracts.sourceProgress(`private text\nCADDY_SOURCE_V1 start ${id}\n`),
    {
      lastStarted: id,
      lastCompleted: null,
      completedCount: 0,
    },
  );
});

test("Caddy source progress validates the entire ordered prefix and both byte bounds", () => {
  const first = contracts.sourceIds[0];
  const second = contracts.sourceIds[1];
  assert.ok(first !== undefined && second !== undefined);
  const start = `CADDY_SOURCE_V1 start ${first}\n`;
  const done = `CADDY_SOURCE_V1 completed ${first}\n`;
  assert.deepEqual(contracts.sourceProgress(start + done), {
    lastStarted: first,
    lastCompleted: first,
    completedCount: 1,
  });
  assert.deepEqual(
    contracts.sourceProgress(
      start + done + `CADDY_SOURCE_V1 start ${second}\n`,
    ),
    { lastStarted: second, lastCompleted: first, completedCount: 1 },
  );
  const complete = contracts.sourceIds
    .map(
      (id) => `CADDY_SOURCE_V1 start ${id}\nCADDY_SOURCE_V1 completed ${id}\n`,
    )
    .join("");
  assert.ok(Buffer.byteLength(complete) < 32768);
  assert.equal(
    contracts.sourceProgress(complete)?.completedCount,
    contracts.sourceIds.length,
  );
  const invalid = [
    "",
    "legacy private output\n",
    start.slice(0, -1),
    start + "CADDY_SOURCE_V1 compl",
    done,
    start + start,
    start + done + done,
    start + done + start,
    `CADDY_SOURCE_V1 start ${second}\n`,
    start + `CADDY_SOURCE_V1 completed ${second}\n`,
    start.replace("V1", "V2"),
    start.replace("start", "unknown"),
    start.replace(first, "private-id"),
    "private-prefix " + start,
    start.replace("\n", "\r\n"),
    start.replace("start ", "start  "),
    start + "CADDY_SOURCE_private-data\n",
    complete + start,
    start + "CADDY_SOURCE" + "x".repeat(32768) + "\n",
    start + "x".repeat(1_048_576),
  ];
  for (const raw of invalid) assert.equal(contracts.sourceProgress(raw), null);
  assert.equal(contracts.sourceProgress({ toString: () => start }), null);
  assert.deepEqual(
    contracts.sourceProgress(
      start + "x".repeat(1_048_576 - Buffer.byteLength(start)),
    ),
    { lastStarted: first, lastCompleted: null, completedCount: 0 },
  );
});

test("Caddy timeout and nonzero assertions publish only closed source progress", () => {
  const id = contracts.sourceIds[0];
  const prefix = `CADDY_SOURCE_V1 start ${id}\n`;
  /** @type {("timeout" | "interrupted" | "output_limit" | "exit")[]} */
  const reasons = ["timeout", "interrupted", "output_limit", "exit"];
  for (const reason of reasons) {
    for (const stderr of [
      "private-auth-canary\n",
      prefix + "private-auth-canary\n",
      prefix + "CADDY_SOURCE_bad-private\n",
    ]) {
      const result = {
        code: reason === "exit" ? 3 : null,
        signal: null,
        pid: undefined,
        reason,
        stdout: "private-stdout-canary",
        stderr,
      };
      try {
        contracts.assertCaddyContracts(result);
        assert.fail("controlled primary failure hidden");
      } catch (error) {
        assert.ok(error instanceof assert.AssertionError);
        assert.equal(error.actual, reason === "exit" ? 3 : reason);
        assert.equal(error.expected, reason === "exit" ? 0 : "exit");
        assert.ok(!error.message.includes("private-"));
        assert.ok(!error.stack?.includes("private-"));
        assert.ok(
          error.message.includes(
            stderr === prefix + "private-auth-canary\n"
              ? "lastStarted="
              : "unknown",
          ),
        );
      }
    }
  }
  contracts.assertCaddyContracts({
    code: 0,
    signal: null,
    pid: undefined,
    reason: "exit",
    stdout: "private-stdout",
    stderr: "legacy private stderr",
  });
});

// deterministic-test-allow unit-io: real source callback/timeout transport over the existing controlled fixture; runOwnedProcess owns and reaps the complete registered group before private report/socket checks.
test("Caddy acquired-listener timeout retains approved progress and legacy unknown", async () => {
  for (const emit of [true, false]) {
    const directory = await mkdtemp(join(tmpdir(), "inside-caddy-progress-"));
    const report = join(directory, "owner.json");
    const script = `import runpy,sys,unittest
from pathlib import Path
root=Path.cwd()/"scripts/observability-caddy-storage"
sys.path.insert(0,str(root))
import source_progress
class Controlled(unittest.TestCase):
    def runTest(self):pass
    def id(self):return source_progress.SOURCE_IDS[0]
${emit ? "source_progress.ProgressResult(sys.stderr,True,0).startTest(Controlled())" : ""}
sys.argv=[str(root/"contract_runner.py"),"--fixture","timeout",sys.argv[1]]
runpy.run_path(sys.argv[0],run_name="__main__")
`;
    const pending = runOwnedProcess("python3", ["-B", "-c", script, report], {
      timeoutMs: 700,
      terminateGraceMs: 2500,
      cleanupBudgetMs: 5000,
    });
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
            performance.now() < deadline,
            "closed fixture acquisition deadline",
          );
          // deterministic-test-allow duration-wait: poll the fixture's atomic acquired-listener report within the unchanged four-second acquisition barrier.
          await delay(10);
        }
      }
      assert.ok(Buffer.byteLength(raw) <= 4096, "closed fixture report size");
      assert.ok(
        /^\{"pid": [1-9][0-9]{0,9}, "child": [1-9][0-9]{0,9}, "helper": [1-9][0-9]{0,9}, "python": [1-9][0-9]{0,9}, "port": [1-9][0-9]{0,4}\}$/u.test(
          raw,
        ),
        "closed fixture report grammar",
      );
      /** @type {unknown} */
      const state = JSON.parse(raw);
      assert.ok(typeof state === "object" && state !== null);
      /** @param {string} key */
      const number = (key) => {
        /** @type {unknown} */
        const value = Reflect.get(state, key);
        assert.ok(
          typeof value === "number" && Number.isSafeInteger(value) && value > 1,
          "closed fixture field",
        );
        return value;
      };
      const port = number("port");
      assert.ok(port <= 65535, "closed fixture port");
      const result = await pending;
      assert.ok(
        number("python") === result.pid,
        "closed fixture group identity",
      );
      assert.equal(result.reason, "timeout");
      assert.deepEqual(
        contracts.sourceProgress(result.stderr),
        emit
          ? {
              lastStarted: contracts.sourceIds[0],
              lastCompleted: null,
              completedCount: 0,
            }
          : null,
      );
      assert.throws(
        () => contracts.assertCaddyContracts(result),
        (error) =>
          error instanceof assert.AssertionError &&
          error.actual === "timeout" &&
          !error.message.includes("private-"),
      );
      for (const key of ["child", "helper", "python"]) {
        assert.throws(
          () => process.kill(number(key), 0),
          (error) =>
            error instanceof Error && "code" in error && error.code === "ESRCH",
        );
      }
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
    } finally {
      await pending.catch(() => undefined);
      await rm(directory, { recursive: true, force: true });
    }
  }
});
