// @ts-check
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pnpmInvocation } from "./pnpm-invocation.mjs";

test("runs a native pinned executable without interpreting its binary as JavaScript", () => {
  const result = spawnSync(
    ...pnpmInvocation(process.execPath, [
      "-e",
      "console.log(process.argv[1])",
      "native argument",
    ]),
    { encoding: "utf8", timeout: 10_000, killSignal: "SIGKILL" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "native argument\n");
});

test("keeps JavaScript CLI entrypoints working through the selected Node runtime", () => {
  const directory = mkdtempSync(join(tmpdir(), "inside-pnpm-cli-"));
  try {
    const cli = join(directory, "pnpm.cjs");
    writeFileSync(cli, "console.log(process.argv[2]);\n");
    const result = spawnSync(...pnpmInvocation(cli, ["script argument"]), {
      encoding: "utf8",
      timeout: 10_000,
      killSignal: "SIGKILL",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "script argument\n");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
