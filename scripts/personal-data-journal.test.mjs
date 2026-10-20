// @ts-check
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import { spawnOwned, stopOwned } from "./owned-process.mjs";

test("private request journal archive and offline recovery (Python/age adapter)", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "inside-journal-proof-"));
  // unit-io: owned Python/age adapter; supervisor owns descendants and this test owns temp keys.
  const child = spawnOwned(
    "python3",
    ["scripts/personal-data-journal-test.py"],
    {
      env: { ...process.env, TMPDIR: directory },
      stdio: ["ignore", "ignore", "pipe"],
    },
  );
  t.after(async () => {
    try {
      await stopOwned(child, 0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  let diagnostics = "";
  child.stderr?.on("data", (chunk) => {
    diagnostics += String(chunk);
  });
  const [status] = await once(child, "exit", {
    signal: AbortSignal.timeout(120_000),
  });
  assert.equal(status, 0, diagnostics);
});

for (const mode of ["deadline", "interruption"]) {
  test(`journal adapter cleans crypto descendants after ${mode} (process adapter)`, async (t) => {
    // unit-io: synthetic bounded descendant stands in for a stalled age subprocess.
    const child = spawnOwned("python3", [
      "-c",
      [
        "import signal,subprocess,sys",
        "child=subprocess.Popen([sys.executable,'-c','import signal;signal.pause()'])",
        "print(child.pid,flush=True)",
        "signal.pause()",
      ].join(";"),
    ]);
    t.after(() => stopOwned(child, 0));
    assert.ok(child.stdout);
    const [data] = await once(child.stdout, "data", {
      signal: AbortSignal.timeout(10_000),
    });
    const descendant = Number(String(data).trim());
    assert.ok(Number.isSafeInteger(descendant) && descendant > 1);
    const exited = once(child, "exit", { signal: AbortSignal.timeout(10_000) });
    if (mode === "deadline") await stopOwned(child, 0);
    else child.kill("SIGTERM");
    await exited;
    assert.throws(() => process.kill(descendant, 0), { code: "ESRCH" });
  });
}
