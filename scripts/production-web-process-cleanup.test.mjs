// @ts-check
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { signalProcessGroup } from "./process-group-signal.mjs";

for (const [mode, status] of [
  ["launcher-signal", 0],
  ["controller-signal", 143],
  ["missing-group-cleanup", 1],
]) {
  test(`production launcher and fixture clean their owned groups on ${mode}`, () => {
    const result = spawnSync(
      "python3",
      ["scripts/fixtures/production-web-cleanup/probe.py", String(mode)],
      {
        encoding: "utf8",
        timeout: 15_000,
      },
    );
    try {
      assert.equal(result.status, status, `${result.stdout}${result.stderr}`);
      assert.match(result.stdout, /^STOPPED$/mu);
      if (mode === "missing-group-cleanup")
        assert.match(
          result.stderr,
          /launcher pipes stayed open after readiness and SIGTERM/u,
        );
    } finally {
      // The outer contract owns these fixture groups even if its controller fails.
      const groups = result.stdout.match(/^GROUPS ([0-9 ]+)$/mu)?.[1];
      for (const group of groups?.split(" ") ?? [])
        signalProcessGroup(Number(group), "SIGKILL");
    }
  });
}
