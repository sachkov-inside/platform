// @ts-check
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { signalProcessGroup } from "./process-group-signal.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const probe = fileURLToPath(
  new URL("./fixtures/production-web-cleanup/probe.py", import.meta.url),
);

for (const [mode, status] of /** @type {const} */ ([
  ["launcher-signal", 0],
  ["controller-signal", 143],
  ["missing-group-cleanup", 1],
])) {
  test(
    `production launcher and fixture clean their owned groups on ${mode}`,
    { timeout: 45_000 },
    () => {
      const result = spawnSync(
        "python3",
        [probe, mode, "--root", root, "--node", process.execPath],
        { encoding: "utf8", timeout: 40_000 },
      );
      try {
        assert.ifError(result.error);
        assert.equal(result.status, status, `${result.stdout}${result.stderr}`);
        assert.match(result.stdout, /^CLEANED$/mu);
        if (mode === "missing-group-cleanup") {
          assert.match(
            result.stderr,
            /owned load survived launcher-only shutdown/u,
          );
          assert.doesNotMatch(result.stdout, /^STOPPED$/mu);
        } else assert.match(result.stdout, /^STOPPED$/mu);
      } finally {
        // This fallback owns fixture groups; it cannot establish the STOPPED assertion above.
        const groups = result.stdout.match(/^GROUPS ([0-9 ]+)$/mu)?.[1];
        for (const group of groups?.split(" ") ?? [])
          signalProcessGroup(Number(group), "SIGKILL");
      }
    },
  );
}
