// @ts-check
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { spawnOwned, stopOwned } from "./owned-process.mjs";

const script = fileURLToPath(
  new URL("./local-build-context-smoke.sh", import.meta.url),
);

test("context smoke process contract preserves Docker failure and removes its own temporary context", () => {
  const root = mkdtempSync(join(tmpdir(), "context-cleanup-contract-"));
  try {
    mkdirSync(join(root, "bin"));
    writeFileSync(join(root, "bin/docker"), "#!/bin/sh\nexit 7\n", {
      mode: 0o755,
    });
    const result = spawnSync("bash", [script], {
      encoding: "utf8",
      timeout: 10_000,
      env: {
        ...process.env,
        TMPDIR: root,
        PATH: `${join(root, "bin")}:${process.env["PATH"] ?? ""}`,
      },
    });
    assert.equal(result.status, 7, result.stderr);
    assert.deepEqual(readdirSync(root), ["bin"]);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("context smoke process contract cleans its temporary context after interrupted Docker", async () => {
  const root = mkdtempSync(join(tmpdir(), "context-interrupt-contract-"));
  /** @type {import('node:child_process').ChildProcess | undefined} */
  let child;
  try {
    mkdirSync(join(root, "bin"));
    writeFileSync(
      join(root, "bin/docker"),
      `#!/usr/bin/env node
process.stdout.write("CONTEXT_READY\\n");
setInterval(() => {}, 1000);
`,
      { mode: 0o755 },
    );
    child = spawnOwned("bash", [script], {
      timeout: 10_000,
      env: {
        ...process.env,
        TMPDIR: root,
        PATH: `${join(root, "bin")}:${process.env["PATH"] ?? ""}`,
      },
    });
    assert.ok(child.stdout);
    const stdout = child.stdout;
    // deterministic-test-allow duration-wait: bounds failure to observe the mock Docker process barrier.
    const abort = AbortSignal.timeout(5_000);
    await new Promise((resolve, reject) => {
      let output = "";
      stdout.on("data", (/** @type {Buffer} */ chunk) => {
        output += chunk.toString();
        if (output.includes("CONTEXT_READY\n")) resolve(undefined);
      });
      abort.addEventListener(
        "abort",
        () => reject(new Error("Docker barrier did not arrive")),
        { once: true },
      );
      child?.once("exit", () =>
        reject(new Error("Docker exited before the barrier")),
      );
    });
    await stopOwned(child);
    assert.equal(child.exitCode, 143);
    assert.deepEqual(readdirSync(root), ["bin"]);
  } finally {
    if (child !== undefined) await stopOwned(child);
    rmSync(root, { force: true, recursive: true });
  }
});
