// @ts-check
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { it } from "node:test";

const cli = fileURLToPath(new URL("./quality-check.mjs", import.meta.url));

it("keeps the Storybook MCP server out of both agent configs", () => {
  const directory = mkdtempSync(join(tmpdir(), "quality-agent-config-"));
  try {
    mkdirSync(join(directory, ".codex"));
    /** @param {Record<string, unknown>} servers @param {string} codex @param {number} expected */
    const check = (servers, codex, expected) => {
      writeFileSync(join(directory, ".codex/config.toml"), codex);
      writeFileSync(
        join(directory, ".mcp.json"),
        JSON.stringify({ mcpServers: servers }),
      );
      const result = spawnSync(process.execPath, [cli, "agents"], {
        cwd: directory,
        encoding: "utf8",
        timeout: 5_000,
      });
      assert.equal(result.status, expected, result.stderr);
    };
    check({}, "", 0);
    check(
      { "platform-storybook": { url: "http://localhost:6006/mcp" } },
      "",
      1,
    );
    check(
      {},
      '[mcp_servers.platform-storybook]\nurl = "http://localhost:6006/mcp"\n',
      1,
    );
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
