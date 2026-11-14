// @ts-check
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { spawnOwned, stopOwned } from "./owned-process.mjs";
import { commandExit } from "./diagnostic-command.mjs";

test("Compose installation rejects an untrusted download and preserves the previous plugin", async (t) => {
  // unit-io: Python/Bash/curl adapter, no network; the supervisor owns the complete chain.
  const child = spawnOwned(
    "python3",
    ["-B", "scripts/test_install_docker_compose.py"],
    { stdio: "inherit" },
  );
  t.after(() => stopOwned(child, 100));
  // deterministic-test-allow duration-wait: bounds a stuck adapter; supervisor exit proves tree cleanup.
  const deadline = setTimeout(() => void stopOwned(child, 100), 15_000);
  try {
    assert.equal(await commandExit(child), 0);
  } finally {
    clearTimeout(deadline);
    await stopOwned(child, 100);
  }
});

for (const mode of ["deadline", "interruption"]) {
  test(
    `Compose adapter removes a stalled curl after ${mode} (Linux process boundary)`,
    { skip: process.platform !== "linux" },
    async (t) => {
      const directory = mkdtempSync(join(tmpdir(), "inside-compose-lifetime-"));
      t.after(() => rmSync(directory, { recursive: true, force: true }));
      const tools = join(directory, "tools");
      mkdirSync(tools);
      writeFileSync(
        join(tools, "curl"),
        "#!/usr/bin/env python3\nimport os, signal\nprint(os.getpid(), flush=True)\nsignal.pause()\n",
        { mode: 0o755 },
      );
      // unit-io: actual installer with an offline curl double; readiness is the descendant PID.
      const child = spawnOwned(
        "python3",
        [
          "-c",
          "import subprocess,sys; sys.exit(subprocess.call(sys.argv[1:]))",
          "bash",
          resolve("infra/production/host/install-docker-compose.sh"),
          join(directory, "plugins"),
        ],
        {
          env: { ...process.env, PATH: `${tools}:${process.env["PATH"]}` },
        },
      );
      t.after(() => stopOwned(child, 100));
      child.stderr?.resume();
      assert.ok(child.stdout);
      const output = await once(child.stdout, "data", {
        signal: AbortSignal.timeout(10_000),
      });
      const descendant = Number(String(output[0]).trim());
      assert.ok(Number.isSafeInteger(descendant) && descendant > 1);
      const exited = commandExit(child);
      if (mode === "deadline") await stopOwned(child, 100);
      else child.kill("SIGTERM");
      await exited;
      assert.throws(() => process.kill(descendant, 0), { code: "ESRCH" });
    },
  );
}
