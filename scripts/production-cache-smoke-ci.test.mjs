// @ts-check
import assert from "node:assert/strict";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { spawnOwned, stopOwned } from "./owned-process.mjs";

test("isolated cache preparation admits only pinned broker/edge images and preserves failures (process adapter)", async () => {
  const root = mkdtempSync(join(tmpdir(), "inside-cache-preparation-"));
  try {
    const bin = join(root, "bin");
    const scripts = join(root, "scripts");
    mkdirSync(bin);
    mkdirSync(scripts);
    copyFileSync(
      new URL("./production-cache-smoke-ci.sh", import.meta.url),
      join(scripts, "production-cache-smoke-ci.sh"),
    );
    writeFileSync(join(bin, "git"), "#!/bin/sh\nprintf '%040d\\n' 1\n");
    writeFileSync(
      join(bin, "docker"),
      `#!/bin/bash
set -eu
printf '%s\\n' "$*" >>"$CALLS"
case "$1 $2" in
  'compose --project-name')
    if [[ "$*" != *'--no-interpolate --no-env-resolution --no-normalize --no-consistency --format json rabbitmq caddy-smoke' ]]; then exit 54; fi
    printf '%s\\n' "$MODEL" ;;
  'pull '*)
    if [[ "$SCENARIO" == deadline || "$SCENARIO" == interrupt ]]; then exec "$NODE_BINARY" "$HANG_SCRIPT"; fi
    exit "$PULL_STATUS" ;;
  'build '*) ;;
  'image inspect')
    case "$3" in
      *-backend:v1) digit=1 ;;
      *-backend:v2) digit=2 ;;
      *-web:v1) digit=3 ;;
      *-foundation:local) digit=4 ;;
      *) exit 55 ;;
    esac
    printf 'sha256:%064d\\n' "$digit" ;;
  'image rm') ;;
  *) exit 56 ;;
esac
`,
    );
    writeFileSync(
      join(scripts, "production-compose-smoke.sh"),
      `#!/bin/bash
set -eu
test "$PRODUCTION_SMOKE_CACHE_ONLY" = 1
test "$PRODUCTION_SMOKE_SOURCE_SHA" = 0000000000000000000000000000000000000001
test "$PRODUCTION_SMOKE_BACKEND_IMAGE" != "$PRODUCTION_SMOKE_NEXT_BACKEND_IMAGE"
test -f "$PRODUCTION_SMOKE_FOUNDATION_OVERRIDE"
printf '%s\\n' admitted-runtime >>"$CALLS"
exit "$RUNTIME_STATUS"
`,
    );
    chmodSync(join(bin, "docker"), 0o755);
    chmodSync(join(bin, "git"), 0o755);
    const broker = `registry.test/rabbitmq@sha256:${"a".repeat(64)}`;
    const edge = `registry.test/caddy@sha256:${"b".repeat(64)}`;
    const model = {
      services: {
        rabbitmq: { image: broker },
        "caddy-smoke": { image: edge },
        api: { image: "unresolved-app-input" },
      },
    };
    const calls = join(root, "calls");
    const hangScript = join(root, "hang.mjs");
    writeFileSync(
      hangScript,
      "console.log(`descendant-ready:${process.pid}`); setInterval(() => {}, 1000);\n",
    );
    for (const scenario of [
      "success",
      "missing",
      "unpinned",
      "pull-failure",
      "runtime-failure",
      "deadline",
      "interrupt",
    ]) {
      rmSync(calls, { force: true });
      const selected = structuredClone(model);
      if (scenario === "missing")
        delete (
          /** @type {Partial<typeof selected.services>} */ (selected.services)[
            "caddy-smoke"
          ]
        );
      if (scenario === "unpinned")
        selected.services.rabbitmq.image = "registry.test/rabbitmq:mutable";
      const controller = new AbortController();
      let output = "";
      /** @type {(pid: number | null) => void} */
      let publishReady = () => {};
      /** @type {Promise<number | null>} */
      const ready = new Promise((resolve) => {
        publishReady = resolve;
      });
      const child = spawnOwned(
        "bash",
        [join(scripts, "production-cache-smoke-ci.sh")],
        {
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(10_000),
          ]),
          env: {
            ...process.env,
            PATH: `${bin}:${process.env["PATH"] ?? ""}`,
            CALLS: calls,
            MODEL: JSON.stringify(selected),
            SCENARIO: scenario,
            NODE_BINARY: process.execPath,
            HANG_SCRIPT: hangScript,
            PULL_STATUS: scenario === "pull-failure" ? "29" : "0",
            RUNTIME_STATUS: scenario === "runtime-failure" ? "31" : "0",
          },
        },
      );
      /** @type {Error | undefined} */
      let unexpectedError;
      /** @type {Promise<number | null>} */
      const closed = new Promise((resolve) => {
        child.once("close", (status) => {
          publishReady(null);
          resolve(status);
        });
        child.once("error", (error) => {
          if (error.name !== "AbortError") unexpectedError = error;
          publishReady(null);
        });
      });
      /** @param {Buffer} chunk */
      const capture = (chunk) => {
        output += chunk.toString();
        const match = /descendant-ready:(\d+)/u.exec(output);
        if (match?.[1] !== undefined) publishReady(Number(match[1]));
      };
      child.stdout?.on("data", capture);
      child.stderr?.on("data", capture);
      /** @type {number | null} */
      let descendantPid = null;
      try {
        if (scenario === "deadline" || scenario === "interrupt") {
          descendantPid = await ready;
          assert.ok(
            descendantPid !== null &&
              Number.isSafeInteger(descendantPid) &&
              descendantPid > 0,
            output,
          );
          if (scenario === "deadline") {
            // Arm the failure deadline only after the real descendant has published readiness.
            const deadline = AbortSignal.timeout(1);
            deadline.addEventListener(
              "abort",
              () => {
                controller.abort(deadline.reason);
              },
              { once: true },
            );
          } else child.kill("SIGTERM");
        }
        const status = await closed;
        assert.equal(unexpectedError, undefined);
        if (scenario === "deadline" || scenario === "interrupt")
          assert.notEqual(status, 0, output);
        else
          assert.equal(
            status,
            ["missing", "unpinned"].includes(scenario)
              ? 65
              : scenario === "pull-failure"
                ? 29
                : scenario === "runtime-failure"
                  ? 31
                  : 0,
            output,
          );
      } finally {
        await stopOwned(child);
      }
      if (descendantPid !== null) {
        assert.throws(
          () => process.kill(descendantPid, 0),
          { code: "ESRCH" },
          "supervisor must reap the real descendant before fixture cleanup",
        );
      }
      const commands = readFileSync(calls, "utf8").trim().split("\n");
      const pulls = commands.filter((line) => line.startsWith("pull "));
      assert.deepEqual(
        pulls,
        ["missing", "unpinned"].includes(scenario)
          ? []
          : ["pull-failure", "deadline", "interrupt"].includes(scenario)
            ? [`pull ${broker}`]
            : [`pull ${broker}`, `pull ${edge}`],
      );
      assert.equal(
        commands.includes("admitted-runtime"),
        ["success", "runtime-failure"].includes(scenario),
      );
      assert.equal(
        commands.some((line) => line.startsWith("build ")),
        ["success", "runtime-failure"].includes(scenario),
      );
      if (scenario !== "deadline" && scenario !== "interrupt")
        assert.ok(
          commands.some((line) => line.startsWith("image rm ")),
          "owned tag cleanup must run on every normal exit",
        );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
