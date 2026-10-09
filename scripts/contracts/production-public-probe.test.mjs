// @ts-check
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const learningChallenge =
  'Bearer resource_metadata="https://inside.sachkov.dev/.well-known/oauth-protected-resource/mcp/learning", scope="learning:read"';

test("production probe accepts the learner MCP sign-in challenge with an empty body", () => {
  const result = runProbe({ challenge: learningChallenge });
  assert.equal(result.status, 0, result.output);
});

test("production probe rejects a missing or changed learner OAuth challenge", () => {
  for (const challenge of [
    "",
    learningChallenge.replace("inside.sachkov.dev", "sachkov.dev"),
    learningChallenge.replace("learning:read", "materials:manage"),
  ]) {
    const result = runProbe({ challenge });
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /learner OAuth sign-in challenge/u);
  }
});

test("production probe rejects a nonempty learner challenge or changed HTTP status", () => {
  const body = runProbe({ challenge: learningChallenge, body: "unauthorized" });
  assert.equal(body.status, 1, body.output);
  const redirect = runProbe({ challenge: learningChallenge, status: "302" });
  assert.equal(redirect.status, 1, redirect.output);
  assert.match(redirect.output, /return 401, received 302/u);
});

test("production probe retains nonempty API rejections and empty fail-closed routes", () => {
  const api = runProbe({ path: "/integrations/kinescope/v1/webhook" });
  assert.equal(api.status, 1, api.output);
  assert.match(api.output, /non-empty response body/u);
  const authenticatedBoundary = runProbe({
    path: "/integrations/kinescope/v1/webhook",
    body: "unauthorized",
  });
  assert.equal(authenticatedBoundary.status, 0, authenticatedBoundary.output);
  const closed = runProbe({
    path: "/integrations/unknown",
    expected: "404",
    status: "404",
  });
  assert.equal(closed.status, 0, closed.output);
  const open = runProbe({
    path: "/integrations/unknown",
    expected: "404",
    status: "404",
    body: "HTML",
  });
  assert.equal(open.status, 1, open.output);
  assert.match(open.output, /empty fail-closed body/u);
});

/**
 * @param {{challenge?: string, body?: string, status?: string, path?: string, expected?: string}} response
 */
function runProbe(response) {
  const directory = mkdtempSync(join(tmpdir(), "production-public-probe-"));
  // This supplied curl boundary writes one captured response; it starts no descendants.
  writeFileSync(
    join(directory, "curl"),
    `#!/bin/bash
set -eu
while (($#)); do
  case "$1" in
    --output) printf '%s' "$PROBE_BODY" > "$2"; shift ;;
    --dump-header) printf 'HTTP/2 %s\\r\\nWWW-Authenticate: %s\\r\\n\\r\\n' "$PROBE_STATUS" "$PROBE_CHALLENGE" > "$2"; shift ;;
  esac
  shift
done
printf '%s' "$PROBE_STATUS"
`,
    { mode: 0o755 },
  );
  try {
    const result = spawnSync(
      "bash",
      [
        "-euc",
        'source scripts/production-public-probe.sh; runtime_config_dir="$PROBE_DIRECTORY"; PRODUCTION_SMOKE_HTTPS_PORT=38443; assert_public_status GET "$1" "$2"',
        "--",
        response.path ?? "/mcp/learning",
        response.expected ?? "401",
      ],
      {
        encoding: "utf8",
        timeout: 10_000,
        env: {
          ...process.env,
          PATH: `${directory}:${process.env["PATH"] ?? ""}`,
          PROBE_DIRECTORY: directory,
          PROBE_BODY: response.body ?? "",
          PROBE_STATUS: response.status ?? "401",
          PROBE_CHALLENGE: response.challenge ?? "",
        },
      },
    );
    assert.ifError(result.error);
    return { status: result.status, output: result.stdout + result.stderr };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
