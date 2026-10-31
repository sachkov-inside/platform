// @ts-check
import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import {
  createDiagnosticStream,
  firstFailureMarker,
  firstFailureSnapshot,
  trackDiagnosticProcess,
} from "./full-stack-diagnostics.mjs";

test("stream redacts split credential headers and fixture secrets before retaining or publishing", () => {
  /** @type {string[]} */
  const output = [];
  const stream = createDiagnosticStream(
    (line) => output.push(line),
    ["fixture-private"],
  );
  stream.write(Buffer.from("before\n  - cook"));
  stream.write(Buffer.from("ie: private-cookie\nBearer fixture-pri"));
  stream.write(Buffer.from("vate\n  - authorization: Bearer private-header\n"));
  stream.end();
  assert.equal(
    output.join(""),
    "before\n  - cookie: <REDACTED>\nBearer <REDACTED>\n  - authorization: <REDACTED>\n",
  );
});

test("first failure freezes process status and output before later suite output evicts it", () => {
  const entry = {
    name: "Web",
    child: { pid: 123, exitCode: null, signalCode: null },
    output: ["original failure context\n"],
    spawnedAt: "2026-10-28T14:56:00.000Z",
    exitedAt: null,
  };
  /** @type {string[]} */
  const output = [];
  const observe = firstFailureSnapshot(
    () => [entry],
    (line) => output.push(line),
  );
  const stream = createDiagnosticStream((line) => observe(line));
  stream.write(Buffer.from(firstFailureMarker.slice(0, 12)));
  assert.equal(output.length, 0);
  stream.write(Buffer.from(firstFailureMarker.slice(12) + "\n"));
  entry.output.splice(0, 1, "later output\n");
  observe(firstFailureMarker);
  assert.equal(output.length, 1);
  const snapshot = z
    .object({
      kind: z.string(),
      processes: z.array(
        z.object({
          pid: z.number(),
          exitCode: z.number().nullable(),
          output: z.string(),
        }),
      ),
    })
    .parse(JSON.parse(output[0] ?? "{}"));
  assert.equal(snapshot.kind, "fullstack-first-failure");
  assert.equal(snapshot.processes[0]?.pid, 123);
  assert.equal(snapshot.processes[0]?.exitCode, null);
  assert.equal(snapshot.processes[0]?.output, "original failure context\n");
});

test("an owned Playwright failure binds one snapshot to its CI source and failed exit", async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { resolve } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const { spawnOwned, stopOwned } = await import("./owned-process.mjs");
  const { commandExit } = await import("./diagnostic-command.mjs");
  const root = fileURLToPath(new URL("../", import.meta.url));
  const fixture = mkdtempSync(resolve(tmpdir(), "fullstack-reporter-"));
  const web = resolve(root, "apps/web");
  const config = resolve(fixture, "playwright.config.cjs");
  try {
    writeFileSync(
      config,
      `module.exports = ${JSON.stringify({
        testDir: fixture,
        outputDir: resolve(fixture, "results"),
        reporter: [
          [resolve(web, "test/support/full-stack-failure-reporter.mjs")],
        ],
        workers: 1,
        timeout: 10000,
      })};`,
    );
    writeFileSync(
      resolve(fixture, "failure.spec.js"),
      `const {test} = require(${JSON.stringify(resolve(web, "node_modules/@playwright/test"))}); test('controlled failure', () => { throw new Error('controlled failure'); });`,
    );
    const child = spawnOwned(
      process.execPath,
      [
        resolve(web, "node_modules/@playwright/test/cli.js"),
        "test",
        "--config",
        config,
      ],
      { cwd: web, stdio: ["ignore", "pipe", "pipe"] },
    );
    /** @type {string[]} */
    const output = [];
    /** @type {string[]} */
    const snapshots = [];
    const entry = trackDiagnosticProcess("Playwright", child, output);
    const observe = firstFailureSnapshot(
      () => [entry],
      (line) => snapshots.push(line),
      {
        GITHUB_SHA: "252342d99b8e4916b2455a34cfd35f87314de877",
        GITHUB_RUN_ID: "40708346051",
        GITHUB_RUN_ATTEMPT: "1",
        UNRELATED_SECRET: "private-metadata",
      },
    );
    const stream = createDiagnosticStream((line) => {
      output.push(line);
      observe(line);
    });
    child.stdout?.on("data", (/** @type {Buffer} */ chunk) =>
      stream.write(chunk),
    );
    child.stderr?.on("data", (/** @type {Buffer} */ chunk) =>
      stream.write(chunk),
    );
    // deterministic-test-allow duration-wait: bounds the owned Playwright CLI; command exit is the completion barrier.
    const deadline = globalThis.setTimeout(() => {
      void stopOwned(child);
    }, 30_000);
    try {
      assert.equal(await commandExit(child), 1);
      stream.end();
      assert.ok(output.join("").includes(firstFailureMarker));
      assert.equal(snapshots.length, 1);
      const snapshot = z
        .object({
          capturedAt: z.iso.datetime(),
          sourceSha: z.literal("252342d99b8e4916b2455a34cfd35f87314de877"),
          runId: z.literal("40708346051"),
          runAttempt: z.literal("1"),
          processes: z.array(
            z.object({
              exitCode: z.null(),
              spawnedAt: z.iso.datetime(),
              exitedAt: z.null(),
            }),
          ),
        })
        .parse(JSON.parse(snapshots[0] ?? "{}"));
      assert.equal(snapshot.processes.length, 1);
      const processSnapshot = snapshot.processes[0];
      assert.ok(processSnapshot);
      assert.ok(processSnapshot.spawnedAt <= snapshot.capturedAt);
      assert.ok(entry.exitedAt !== null);
      assert.ok(snapshot.capturedAt <= entry.exitedAt);
      observe(firstFailureMarker);
      assert.equal(snapshots.length, 1);
      assert.ok(!snapshots.join("").includes("private-metadata"));
    } finally {
      globalThis.clearTimeout(deadline);
      await stopOwned(child);
    }
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("stream retains UTF-8 across chunks and omits oversized lines without leaking their prefix", () => {
  /** @type {string[]} */
  const output = [];
  const stream = createDiagnosticStream((line) => output.push(line));
  const text = Buffer.from("Привет\n");
  stream.write(text.subarray(0, 1));
  stream.write(text.subarray(1));
  stream.write(Buffer.from("cookie: private-prefix" + "x".repeat(40_001)));
  assert.equal(output.join(""), "Привет\n");
  stream.write(Buffer.from("\nlast line"));
  stream.end();
  assert.equal(
    output.join(""),
    "Привет\n<oversized diagnostic line omitted>\nlast line",
  );
});

test("snapshot omits unknown metadata and replaces missing or invalid CI values with null", () => {
  for (const environment of [
    {},
    {
      GITHUB_SHA: "private-source-hint",
      GITHUB_RUN_ID: "40708346051\nprivate-run-hint",
      GITHUB_RUN_ATTEMPT: "0",
      SOURCE_HINT: "private-source-hint",
    },
    {
      GITHUB_SHA: 123,
      GITHUB_RUN_ID: "1".repeat(21),
      GITHUB_RUN_ATTEMPT: "private-attempt-hint",
    },
  ]) {
    /** @type {string[]} */
    const output = [];
    const observe = firstFailureSnapshot(
      () => [],
      (line) => output.push(line),
      environment,
    );
    observe(firstFailureMarker);
    const snapshot = z
      .object({
        sourceSha: z.null(),
        runId: z.null(),
        runAttempt: z.null(),
      })
      .parse(JSON.parse(output[0] ?? "{}"));
    assert.deepEqual(snapshot, {
      sourceSha: null,
      runId: null,
      runAttempt: null,
    });
    assert.ok(!output.join("").includes("private-"));
  }
});

test("snapshot binds a real exited supervisor to its observed timestamp and command status", async () => {
  const { spawnOwned, stopOwned } = await import("./owned-process.mjs");
  const { commandExit } = await import("./diagnostic-command.mjs");
  const child = spawnOwned(process.execPath, ["-e", "process.exit(7)"], {
    stdio: "ignore",
  });
  // deterministic-test-allow duration-wait: bounds the real owned subprocess; command exit is the completion barrier.
  const deadline = globalThis.setTimeout(() => {
    void stopOwned(child);
  }, 10_000);
  try {
    const entry = trackDiagnosticProcess("exited fixture", child, []);
    assert.equal(await commandExit(child), 7);
    /** @type {string[]} */
    const output = [];
    const observe = firstFailureSnapshot(
      () => [entry],
      (line) => output.push(line),
      {},
    );
    observe(firstFailureMarker);
    const snapshot = z
      .object({
        capturedAt: z.iso.datetime(),
        processes: z.array(
          z.object({
            pid: z.number().int().positive(),
            exitCode: z.literal(7),
            signalCode: z.null(),
            spawnedAt: z.iso.datetime(),
            exitedAt: z.iso.datetime(),
          }),
        ),
      })
      .parse(JSON.parse(output[0] ?? "{}"));
    const observed = snapshot.processes[0];
    assert.ok(observed);
    assert.equal(observed.pid, child.pid);
    assert.ok(observed.spawnedAt <= observed.exitedAt);
    assert.ok(observed.exitedAt <= snapshot.capturedAt);
  } finally {
    globalThis.clearTimeout(deadline);
    await stopOwned(child);
  }
});
