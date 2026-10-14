// @ts-check
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
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
const deadlineFixture = fileURLToPath(
  new URL("./fixtures/context-deadline.py", import.meta.url),
);

test("context smoke removes its temporary context after a successful adapter command", () => {
  const root = mkdtempSync(join(tmpdir(), "context-success-contract-"));
  try {
    mkdirSync(join(root, "bin"));
    writeFileSync(
      join(root, "bin/docker"),
      `#!/usr/bin/env node
import {copyFileSync,mkdirSync,statSync,utimesSync,writeFileSync} from "node:fs";
const output=process.argv.at(-2).split("dest=")[1];
if(output.endsWith("/backend") || output.endsWith("/web")) {
  mkdirSync(output+"/workspace/patches",{recursive:true});
  copyFileSync(process.argv.at(-1)+"/installed.patch",output+"/workspace/patches/proof.patch");
  const installed=statSync(process.argv.at(-1)+"/installed.patch");
  utimesSync(output+"/workspace/patches/proof.patch",installed.atime,installed.mtime);
  copyFileSync(output+"/workspace/patches/proof.patch",output+"/dependency-installed.patch");
  utimesSync(output+"/dependency-installed.patch",installed.atime,installed.mtime);
  writeFileSync(output+"/workspace/package.json","fixture source");
  process.exit(0);
}
mkdirSync(output+"/docs/evidence",{recursive:true});
writeFileSync(output+"/package.json","fixture source");writeFileSync(output+"/docs/evidence/proof.txt","fixture evidence");
`,
      { mode: 0o755 },
    );
    const result = spawnSync("bash", [script], {
      encoding: "utf8",
      timeout: 10_000,
      env: {
        ...process.env,
        TMPDIR: root,
        PATH: `${join(root, "bin")}:${process.env["PATH"] ?? ""}`,
      },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readdirSync(root), ["bin"]);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

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

test("context smoke's own deadline stops a blocked Docker plugin and its child", async () => {
  const root = mkdtempSync(join(tmpdir(), "context-deadline-contract-"));
  /** @type {import('node:child_process').ChildProcess | undefined} */
  let child;
  try {
    mkdirSync(join(root, "bin"));
    writeFileSync(
      join(root, "bin/python3"),
      `#!/bin/sh
fixture_python="$(PATH="$CONTEXT_FIXTURE_PATH" command -v python3)"
case "$1" in
  */local-build-context-smoke.py) exec "$fixture_python" "$CONTEXT_DEADLINE_FIXTURE" "$@" ;;
  *) exec "$fixture_python" "$@" ;;
esac
`,
      { mode: 0o755 },
    );
    writeFileSync(
      join(root, "bin/docker"),
      `#!/usr/bin/env node
import {spawn} from "node:child_process"; import {writeFileSync} from "node:fs";
process.on("SIGTERM", () => {});
const plugin = spawn(process.execPath, ["-e", "process.on('SIGTERM', () => {}); process.stdout.write('PLUGIN_READY'); setInterval(() => {}, 1000)"], {stdio:["ignore", "pipe", "ignore"]});
plugin.stdout.once("data", () => {
  writeFileSync(${JSON.stringify(join(root, "pid"))}, String(plugin.pid));
  writeFileSync(${JSON.stringify(join(root, "docker-pid"))}, String(process.pid));
  process.stdout.write("CONTEXT_READY\\n");
});
setInterval(() => {}, 1000);
`,
      { mode: 0o755 },
    );
    child = spawnOwned("bash", [script], {
      timeout: 10_000,
      env: {
        ...process.env,
        TMPDIR: root,
        LOCAL_CONTEXT_BUILD_TIMEOUT_SECONDS: "1",
        CONTEXT_FIXTURE_PATH: process.env["PATH"] ?? "",
        CONTEXT_DEADLINE_FIXTURE: deadlineFixture,
        PATH: `${join(root, "bin")}:${process.env["PATH"] ?? ""}`,
      },
    });
    let stderr = "";
    child.stderr?.on("data", (/** @type {Buffer} */ chunk) => {
      stderr += chunk.toString();
    });
    const status = await new Promise(
      /** @param {(status: number | null) => void} resolve */ (
        resolve,
        reject,
      ) => {
        child?.once("error", reject);
        child?.once("exit", resolve);
      },
    );
    assert.equal(status, 124, stderr);
    const pid = Number(readFileSync(join(root, "pid"), "utf8"));
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
    const dockerPid = Number(readFileSync(join(root, "docker-pid"), "utf8"));
    assert.throws(() => process.kill(dockerPid, 0), { code: "ESRCH" });
    assert.deepEqual(readdirSync(root).sort(), ["bin", "docker-pid", "pid"]);
  } finally {
    if (child !== undefined) await stopOwned(child);
    rmSync(root, { force: true, recursive: true });
  }
});
