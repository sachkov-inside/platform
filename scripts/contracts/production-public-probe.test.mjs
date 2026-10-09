// @ts-check
import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  watch,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { commandExit } from "../diagnostic-command.mjs";
import { spawnOwned, stopOwned } from "../owned-process.mjs";

const learningChallenge =
  'Bearer resource_metadata="https://inside.sachkov.dev/.well-known/oauth-protected-resource/mcp/learning", scope="learning:read"';

test("production probe accepts the learner MCP sign-in challenge with an empty body", async () => {
  const result = await runProbe({ challenge: learningChallenge });
  assert.equal(result.status, 0, result.output);
  const mixedCaseHeader = await runProbe({
    challenge: learningChallenge,
    headerName: "wWw-aUtHeNtIcAtE",
  });
  assert.equal(mixedCaseHeader.status, 0, mixedCaseHeader.output);
});

test("production probe rejects a missing or changed learner OAuth challenge", async () => {
  for (const challenge of [
    "",
    learningChallenge.replace("inside.sachkov.dev", "sachkov.dev"),
    learningChallenge.replace("learning:read", "materials:manage"),
    learningChallenge.replace("learning:read", "learning:READ"),
    learningChallenge.replace("/.well-known/", "/.WELL-KNOWN/"),
  ]) {
    const result = await runProbe({ challenge });
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /learner OAuth sign-in challenge/u);
  }
});

test("production probe rejects a nonempty learner challenge or changed HTTP status", async () => {
  const body = await runProbe({
    challenge: learningChallenge,
    body: "unauthorized",
  });
  assert.equal(body.status, 1, body.output);
  const redirect = await runProbe({
    challenge: learningChallenge,
    status: "302",
  });
  assert.equal(redirect.status, 1, redirect.output);
  assert.match(redirect.output, /return 401, received 302/u);
});

test("production probe retains nonempty API rejections and empty fail-closed routes", async () => {
  const api = await runProbe({ path: "/integrations/kinescope/v1/webhook" });
  assert.equal(api.status, 1, api.output);
  assert.match(api.output, /non-empty response body/u);
  const authenticatedBoundary = await runProbe({
    path: "/integrations/kinescope/v1/webhook",
    body: "unauthorized",
  });
  assert.equal(authenticatedBoundary.status, 0, authenticatedBoundary.output);
  const closed = await runProbe({
    path: "/integrations/unknown",
    expected: "404",
    status: "404",
  });
  assert.equal(closed.status, 0, closed.output);
  const open = await runProbe({
    path: "/integrations/unknown",
    expected: "404",
    status: "404",
    body: "HTML",
  });
  assert.equal(open.status, 1, open.output);
  assert.match(open.output, /empty fail-closed body/u);
});

for (const cancellation of ["timeout", "interruption"]) {
  test(`production probe ${cancellation} leaves no blocked curl descendant`, async () => {
    const directory = mkdtempSync(
      join(tmpdir(), "production-probe-cancellation-"),
    );
    const pidPath = join(directory, "pid");
    const controller = new AbortController();
    /** @type {import("node:fs").FSWatcher | undefined} */
    let watcher;
    /** @type {number | undefined} */
    let pid;
    try {
      if (cancellation === "interruption") {
        // Interrupt only after the curl fixture has committed its listening descendant's PID.
        watcher = watch(directory, () => {
          if (!existsSync(pidPath)) return;
          const value = readFileSync(pidPath, "utf8");
          if (!/^[1-9][0-9]*$/.test(value)) return;
          controller.abort();
        });
      }
      await assert.rejects(
        runProbe({ descendantPidPath: pidPath }, { signal: controller.signal }),
        { name: "AbortError" },
      );
      const childPid = Number(readFileSync(pidPath, "utf8"));
      pid = childPid;
      assert.ok(Number.isSafeInteger(childPid) && childPid > 0);
      assert.throws(() => process.kill(childPid, 0), { code: "ESRCH" });
    } finally {
      watcher?.close();
      // Rescue only this fixture's descendant if a regression leaves it alive.
      if (pid === undefined && existsSync(pidPath))
        pid = Number(readFileSync(pidPath, "utf8"));
      if (pid !== undefined && Number.isSafeInteger(pid) && pid > 0) {
        try {
          process.kill(pid, "SIGKILL");
        } catch (error) {
          if (!(
            error instanceof Error &&
            "code" in error &&
            error.code === "ESRCH"
          ))
            throw error;
        }
      }
      rmSync(directory, { recursive: true, force: true });
    }
  });
}

/**
 * @param {{challenge?: string, headerName?: string, body?: string, status?: string, path?: string, expected?: string, descendantPidPath?: string}} response
 * @param {{signal?: AbortSignal}} [controls]
 */
async function runProbe(response, controls = {}) {
  const directory = mkdtempSync(join(tmpdir(), "production-public-probe-"));
  /** @type {import("node:child_process").ChildProcess | undefined} */
  let child;
  try {
    // Normal curl writes one response; cancellation cases hold an owned loopback descendant.
    writeFileSync(
      join(directory, "curl"),
      `#!/bin/bash
set -eu
if [[ -n "$PROBE_DESCENDANT_PID_PATH" ]]; then
  "$PROBE_NODE" -e 'const fs=require("node:fs"); const net=require("node:net"); process.on("SIGHUP",()=>{}); net.createServer().listen(0,"127.0.0.1",()=>fs.writeFileSync(process.env.PROBE_DESCENDANT_PID_PATH,String(process.pid)));' >/dev/null 2>&1 &
  wait
fi
while (($#)); do
  case "$1" in
    --output) printf '%s' "$PROBE_BODY" > "$2"; shift ;;
    --dump-header) printf 'HTTP/2 %s\\r\\n%s: %s\\r\\n\\r\\n' "$PROBE_STATUS" "$PROBE_HEADER_NAME" "$PROBE_CHALLENGE" > "$2"; shift ;;
  esac
  shift
done
printf '%s' "$PROBE_STATUS"
`,
      { mode: 0o755 },
    );
    child = spawnOwned(
      "bash",
      [
        "-euc",
        'source scripts/production-public-probe.sh; runtime_config_dir="$PROBE_DIRECTORY"; PRODUCTION_SMOKE_HTTPS_PORT=38443; assert_public_status GET "$1" "$2"',
        "--",
        response.path ?? "/mcp/learning",
        response.expected ?? "401",
      ],
      {
        stdio: ["ignore", "pipe", "pipe"],
        signal: AbortSignal.any([
          AbortSignal.timeout(10_000),
          ...(controls.signal === undefined ? [] : [controls.signal]),
        ]),
        env: {
          ...process.env,
          PATH: `${directory}:${process.env["PATH"] ?? ""}`,
          PROBE_DIRECTORY: directory,
          PROBE_BODY: response.body ?? "",
          PROBE_STATUS: response.status ?? "401",
          PROBE_CHALLENGE: response.challenge ?? "",
          PROBE_HEADER_NAME: response.headerName ?? "WWW-Authenticate",
          PROBE_DESCENDANT_PID_PATH: response.descendantPidPath ?? "",
          PROBE_NODE: process.execPath,
        },
      },
    );
    /** @type {string[]} */
    const output = [];
    for (const stream of [child.stdout, child.stderr])
      stream?.on("data", (/** @type {Buffer} */ chunk) =>
        output.push(chunk.toString()),
      );
    return { status: await commandExit(child), output: output.join("") };
  } finally {
    try {
      if (child !== undefined) await stopOwned(child);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
}
