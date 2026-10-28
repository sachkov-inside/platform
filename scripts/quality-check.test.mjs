// @ts-check
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { it } from "node:test";
import { qualityCommand } from "./quality-command.mjs";
import { readPackageManifest } from "./package-manifest.mjs";

const cli = fileURLToPath(new URL("./quality-check.mjs", import.meta.url));

it("declares root proof dependencies at their application owners' exact versions", () => {
  const rootManifest = new URL("../package.json", import.meta.url);
  const root = readPackageManifest(fileURLToPath(rootManifest));
  const rootRequire = createRequire(rootManifest);
  for (const { dependency, application, section } of [
    { dependency: "pg", application: "backend", section: "dependencies" },
    { dependency: "fastify", application: "backend", section: "dependencies" },
    { dependency: "tsx", application: "telegram", section: "devDependencies" },
  ]) {
    const ownerManifest = new URL(
      `../apps/${application}/package.json`,
      import.meta.url,
    );
    const owner = readPackageManifest(fileURLToPath(ownerManifest));
    const expected = (
      section === "dependencies" ? owner.dependencies : owner.devDependencies
    )[dependency];
    assert.ok(expected, `${dependency} must have an application owner`);
    assert.equal(root.devDependencies[dependency], expected);
    assert.equal(
      root.dependencies[dependency],
      undefined,
      "proof packages must stay development-only",
    );
    assert.equal(
      realpathSync(rootRequire.resolve(`${dependency}/package.json`)),
      realpathSync(
        createRequire(ownerManifest).resolve(`${dependency}/package.json`),
      ),
      "the proof and its application owner must resolve the same installed package",
    );
  }
});

// deterministic-test-allow unit-io: real sourced Bash writer input contract; qualityCommand owns and reaps each five-second process tree.
it("rejects missing disposable writer inputs before creating configuration files", async () => {
  const writer = fileURLToPath(
    new URL("./production-runtime-configuration.sh", import.meta.url),
  );
  const inputs = {
    runtime_config_dir: "",
    release_version: "v1",
    source_sha: "a".repeat(40),
    smoke_encryption_key: "A".repeat(43) + "=",
  };
  for (const missing of Object.keys(inputs)) {
    const directory = mkdtempSync(join(tmpdir(), "quality-writer-inputs-"));
    try {
      /** @type {NodeJS.ProcessEnv} */
      const env = {
        PATH: process.env["PATH"],
        ...inputs,
        runtime_config_dir: directory,
      };
      delete env[missing];
      const result = await qualityCommand(
        "/bin/bash",
        [
          "-c",
          'set -eu; source "$1"; write_disposable_runtime_configuration',
          "writer-proof",
          writer,
        ],
        { env, timeout: 5000 },
      );
      assert.equal(result.status, 1, `missing ${missing} must fail`);
      assert.deepEqual(
        readdirSync(directory),
        [],
        `missing ${missing} must not write configuration`,
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

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
