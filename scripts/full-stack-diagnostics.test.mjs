// @ts-check
import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import {
  createDiagnosticStream,
  firstFailureMarker,
  firstFailureSnapshot,
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

test("an owned Playwright run emits the failure marker and preserves a failed exit", async () => {
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
    child.stdout?.on("data", (/** @type {Buffer} */ chunk) =>
      output.push(chunk.toString()),
    );
    child.stderr?.on("data", (/** @type {Buffer} */ chunk) =>
      output.push(chunk.toString()),
    );
    // deterministic-test-allow duration-wait: bounds the owned Playwright CLI; command exit is the completion barrier.
    const deadline = globalThis.setTimeout(() => {
      void stopOwned(child);
    }, 30_000);
    try {
      assert.equal(await commandExit(child), 1);
      assert.ok(
        output.join("").includes(firstFailureMarker),
        "real reporter emitted a safe failure signal",
      );
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
