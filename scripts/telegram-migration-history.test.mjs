// @ts-check
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdtempSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { it } from "node:test";

it("permits an appended Telegram migration but rejects edits, deletions and renames of the shipped prefix", () => {
  const directory = mkdtempSync(join(tmpdir(), "telegram-migration-history-"));
  const source = fileURLToPath(
    new URL("../apps/telegram/src/database/migrations", import.meta.url),
  );
  const checker = fileURLToPath(
    new URL(
      "../apps/telegram/scripts/check-migration-history.mjs",
      import.meta.url,
    ),
  );
  /** @param {boolean} accepted */
  const check = (accepted) => {
    const result = spawnSync(process.execPath, [checker, directory], {
      encoding: "utf8",
      timeout: 10_000,
    });
    assert.equal(result.status, accepted ? 0 : 1, result.stderr);
    if (!accepted) assert.match(result.stderr, /historical migration/u);
  };
  try {
    cpSync(source, directory, { recursive: true });
    check(true);
    writeFileSync(
      join(directory, "039-appended.ts"),
      "export const appended = true;\n",
    );
    check(true);
    const original = join(directory, "001-ordinary-start.ts");
    writeFileSync(original, "changed\n");
    check(false);
    cpSync(source, directory, { recursive: true });
    renameSync(original, join(directory, "001-renamed.ts"));
    check(false);
    rmSync(join(directory, "001-renamed.ts"));
    check(false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
