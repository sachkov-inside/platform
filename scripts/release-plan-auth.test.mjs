import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, it } from "node:test";

describe("release settings authentication", () => {
  it("uses settings access only for the administration endpoint", () => {
    const result = runPlan();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).version, "v1");
    assert.deepEqual(result.calls, ["settings", "standard", "standard", "standard"]);
  });

  it("requires settings credentials before calling GitHub", () => {
    const result = runPlan({ RELEASE_SETTINGS_READ_TOKEN: "" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /RELEASE_SETTINGS_READ_TOKEN is required/u);
    assert.deepEqual(result.calls, []);
  });

  it("stops on denied settings access without falling back to the standard token", () => {
    const result = runPlan({ SETTINGS_RESULT: "denied" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Resource not accessible by integration/u);
    assert.equal(result.calls.length, 1);
  });

  it("stops before reading release history when immutability is disabled", () => {
    const result = runPlan({ SETTINGS_RESULT: "disabled" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /immutability must be enabled/u);
    assert.deepEqual(result.calls, ["settings"]);
  });
});

function runPlan(overrides = {}) {
  const directory = mkdtempSync(resolve(tmpdir(), "inside-release-auth-"));
  const calls = resolve(directory, "calls");
  writeFileSync(calls, "");
  writeFileSync(resolve(directory, "gh"), `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const endpoint = process.argv.find(value => value.startsWith("repos/"));
const settings = endpoint?.endsWith("/immutable-releases");
if (process.env.RELEASE_SETTINGS_READ_TOKEN !== undefined) process.exit(3);
const credential = process.env.GH_TOKEN === "settings-read" ? "settings" : "standard";
appendFileSync(process.env.AUTH_CALLS, credential + "\\n");
if (settings) {
  if (credential !== "settings" || process.env.SETTINGS_RESULT === "denied") {
    process.stderr.write("Resource not accessible by integration (HTTP 403)\\n");
    process.exit(1);
  }
  console.log(process.env.SETTINGS_RESULT === "disabled" ? "false" : "true");
} else {
  if (credential !== "standard") process.exit(2);
  console.log(endpoint?.endsWith("/git/ref/heads/main") ? process.env.SOURCE_SHA : "[[]]");
}
`, { mode: 0o755 });
  try {
    const result = spawnSync("bash", ["scripts/plan-release.sh"], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${directory}:${process.env.PATH}`,
        GH_TOKEN: "workflow-token",
        RELEASE_SETTINGS_READ_TOKEN: "settings-read",
        GITHUB_REPOSITORY: "sachkov-inside/platform",
        REQUESTED_VERSION: "v1",
        SOURCE_SHA: "a".repeat(40),
        AUTH_CALLS: calls,
        SETTINGS_RESULT: "enabled",
        ...overrides,
      },
    });
    return { ...result, calls: readFileSync(calls, "utf8").split("\n").filter(Boolean) };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
