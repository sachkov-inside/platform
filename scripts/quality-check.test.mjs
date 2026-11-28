// @ts-check
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { it } from "node:test";

const cli = fileURLToPath(new URL("./quality-check.mjs", import.meta.url));

it("runs the production moderate audit and preserves advisory and provider failures", () => {
  const directory = mkdtempSync(join(tmpdir(), "quality-audit-cli-"));
  try {
    writeFileSync(
      join(directory, "pnpm"),
      '#!/bin/sh\nprintf "%s\\n" "$@"\nexit "$AUDIT_FIXTURE_EXIT"\n',
      { mode: 0o755 },
    );
    for (const code of [0, 1, 2]) {
      const result = spawnSync(process.execPath, [cli, "audit"], {
        cwd: directory,
        encoding: "utf8",
        timeout: 5_000,
        env: {
          ...process.env,
          PATH: `${directory}${delimiter}${process.env["PATH"] ?? ""}`,
          AUDIT_FIXTURE_EXIT: String(code),
        },
      });
      assert.equal(result.status, code, result.stderr);
      assert.deepEqual(result.stdout.trim().split("\n"), [
        "audit",
        "--prod",
        "--audit-level=moderate",
      ]);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
