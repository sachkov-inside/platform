// @ts-check
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { it } from "node:test";

const cli = fileURLToPath(new URL("./quality-check.mjs", import.meta.url));

it("accepts the shared MCP endpoint and rejects disagreement or malformed JSON", () => {
  const directory = mkdtempSync(join(tmpdir(), "quality-agent-config-"));
  try {
    mkdirSync(join(directory, ".codex"));
    writeFileSync(
      join(directory, ".codex/config.toml"),
      '[mcp_servers.platform-storybook]\nurl = "http://localhost:6006/mcp"\n',
    );
    /** @param {string} url @param {number} expected */
    const check = (url, expected) => {
      writeFileSync(
        join(directory, ".mcp.json"),
        JSON.stringify({
          mcpServers: { "platform-storybook": { type: "http", url } },
        }),
      );
      const result = spawnSync(process.execPath, [cli, "agents"], {
        cwd: directory,
        encoding: "utf8",
        timeout: 5_000,
      });
      assert.equal(result.status, expected, result.stderr);
    };
    check("http://localhost:6006/mcp", 0);
    check("http://localhost:6007/mcp", 1);
    check("invalid", 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

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
