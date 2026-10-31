// @ts-check
import assert from "node:assert/strict";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { z } from "zod";
import { runReviewProcess } from "./review-evidence.test-support.mjs";
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
    for (const name of [
      "production-cache-diagnostics.mjs",
      "cgroup-memory-diagnostics.mjs",
      "owned-process.mjs",
      "owned-process.py",
      "diagnostic-command.mjs",
    ]) {
      copyFileSync(new URL(`./${name}`, import.meta.url), join(scripts, name));
    }
    for (const name of ["heavy-check", "owned-process"]) {
      cpSync(new URL(`./${name}`, import.meta.url), join(scripts, name), {
        recursive: true,
      });
    }
    writeFileSync(join(bin, "git"), "#!/bin/sh\nprintf '%040d\\n' 1\n");
    // deterministic-test-allow duration-wait: fake healthy cleanup exceeds the observation budget; process exit owns success, without an elapsed-time assertion.
    writeFileSync(
      join(bin, "docker"),
      `#!/bin/bash
set -eu
printf '%s\\n' "$*" >>"$CALLS"
case "$1 $2" in
  'compose --env-file')
    if [[ "$*" != *'--env-file /dev/null --project-name'*'config --no-env-resolution --no-normalize --no-consistency --format json rabbitmq caddy-smoke' ]]; then exit 54; fi
    case "$PLATFORM_CONFIG_DIR" in "$TMPDIR"/inside-cache-model-*) ;; *) exit 57 ;; esac
    test -f "$PLATFORM_RELEASE_ENV_FILE"
    test ! -s "$PLATFORM_RELEASE_ENV_FILE"
    printf '%s\\n' "$MODEL" ;;
  'pull '*)
    if [[ "$SCENARIO" == deadline || "$SCENARIO" == interrupt ]]; then exec "$NODE_BINARY" "$HANG_SCRIPT"; fi
    exit "$PULL_STATUS" ;;
  'build '*)
    if [[ "$SCENARIO" == build-eof ]]; then echo 'rpc EOF' >&2; exit 47; fi ;;
  'image inspect')
    case "$3" in
      *-backend:v1) digit=1 ;;
      *-backend:v2) digit=2 ;;
      *-web:v1) digit=3 ;;
      *-foundation:local) digit=4 ;;
      *) exit 55 ;;
    esac
    printf 'sha256:%064d\\n' "$digit" ;;
  'image rm')
    # Intentional adapter latency proves healthy cleanup may exceed observation deadlines.
    if [[ "$SCENARIO" == slow-cleanup ]]; then exec "$NODE_BINARY" -e 'setTimeout(() => {}, 2000)'; fi
    if [[ "$SCENARIO" == build-eof || "$SCENARIO" == cleanup-failure ]]; then echo 'Authorization: Bearer CANARY_cleanup_secret' >&2; exit 59; fi ;;
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
    mkdirSync(join(scripts, "fixtures", "production-runtime"), {
      recursive: true,
    });
    copyFileSync(
      new URL("../compose.production.yaml", import.meta.url),
      join(root, "compose.production.yaml"),
    );
    copyFileSync(
      new URL(
        "./fixtures/production-runtime/compose.smoke.yaml",
        import.meta.url,
      ),
      join(scripts, "fixtures", "production-runtime", "compose.smoke.yaml"),
    );
    for (const name of ["sudo", "systemctl", "free", "df", "cat"]) {
      writeFileSync(join(bin, name), "#!/bin/sh\necho safe-diagnostic\n");
      chmodSync(join(bin, name), 0o755);
    }
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
      "slow-cleanup",
      "cleanup-failure",
      "missing",
      "unpinned",
      "pull-failure",
      "build-eof",
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
            TMPDIR: root,
            PLATFORM_CONFIG_DIR: "/unrelated-runtime-configuration",
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
                  : scenario === "build-eof"
                    ? 47
                    : scenario === "cleanup-failure"
                      ? 1
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
      if (scenario === "build-eof" || scenario === "cleanup-failure") {
        const artifact = readFileSync(
          join(
            root,
            "ci-artifacts/compose-production-cache/preparation-after.json",
          ),
          "utf8",
        );
        assert.match(
          artifact,
          scenario === "build-eof" ? /"status": 47/u : /"status": 0/u,
        );
        assert.match(
          readFileSync(
            join(
              root,
              "ci-artifacts/compose-production-cache/preparation-before.json",
            ),
            "utf8",
          ),
          /"phase": "preparation"/u,
        );
        assert.match(
          artifact,
          scenario === "build-eof" ? /build-backend-v1/u : /runtime/u,
        );
        assert.match(artifact, /"status": 59/u);
        assert.doesNotMatch(artifact, /CANARY_cleanup_secret/u);
      }
      if (scenario === "slow-cleanup") {
        const artifact = readFileSync(
          join(
            root,
            "ci-artifacts/compose-production-cache/preparation-after.json",
          ),
          "utf8",
        );
        assert.match(
          artifact,
          /"cleanup": \{\s+"status": 0,\s+"timedOut": false/u,
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
        [
          "success",
          "runtime-failure",
          "cleanup-failure",
          "slow-cleanup",
        ].includes(scenario),
      );
      assert.equal(
        commands.some((line) => line.startsWith("build ")),
        [
          "success",
          "runtime-failure",
          "cleanup-failure",
          "build-eof",
          "slow-cleanup",
        ].includes(scenario),
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

test("preparation captures redact secrets, record failures and reap timed-out commands (process adapter)", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "cache-diagnostic-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = join(root, "bin");
  mkdirSync(bin);
  const pidFile = join(root, "pid");
  const hang = join(root, "hang.mjs");
  writeFileSync(
    hang,
    `import {writeFileSync} from 'node:fs'; writeFileSync(process.env.PID_FILE, String(process.pid)); process.on('SIGTERM',()=>{}); setInterval(()=>{},1000);`,
  );
  for (const name of ["docker", "sudo", "systemctl", "free", "df", "cat"]) {
    const file = join(bin, name);
    writeFileSync(
      file,
      `#!/bin/sh
if [ "$SCENARIO" = timeout ] && [ "$1" = version ]; then exec "$NODE_BINARY" "$HANG_SCRIPT"; fi
if [ "$1" = -n ] && [ "$2" = journalctl ]; then
  case "$*" in
    *--kernel*) echo 'journalctl: unrecognized option'; exit 64 ;;
    *' -k '*) echo 'No OOM entries'; exit 0 ;;
  esac
fi
printf '%s\\n' 'safe daemon restart marker' 'https://user:CANARY_urlpass@host/path?key=CANARY_query' 'token=CANARY_token' 'Authorization: Bearer CANARY_auth' '${["ghp", "CANARYgithubtoken12345678901234567890"].join("_")}' 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJjYW5hcnkifQ.signature' 'EYJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJjYW5hcnkifQ.signature'
if [ "$1" = image ]; then exit 0; fi
exit 7
`,
    );
    chmodSync(file, 0o755);
  }
  for (const scenario of ["capture-failure", "timeout"]) {
    const artifact = join(root, scenario);
    const result = await runReviewProcess(
      process.execPath,
      [
        new URL("./production-cache-diagnostics.mjs", import.meta.url).pathname,
        "after",
        artifact,
        "inside-platform-production-smoke-cache-ci-1",
        "1".repeat(40),
        "build-backend-v1",
        "47",
      ],
      {
        env: {
          ...process.env,
          PATH: `${bin}:${process.env["PATH"]}`,
          SCENARIO: scenario,
          NODE_BINARY: process.execPath,
          HANG_SCRIPT: hang,
          PID_FILE: pidFile,
          GITHUB_RUN_ID: "123",
          GITHUB_RUN_ATTEMPT: "1",
        },
        timeoutMilliseconds: 15000,
      },
    );
    assert.equal(result.status, 0, result.stderr);
    const saved = readFileSync(
      join(artifact, "preparation-after.json"),
      "utf8",
    );
    const snapshot = z
      .object({
        captures: z.object({ "kernel-oom": z.object({ status: z.number() }) }),
      })
      .parse(JSON.parse(saved));
    assert.equal(
      snapshot.captures["kernel-oom"].status,
      0,
      "Kernel journal probe must use supported -k option",
    );
    assert.match(saved, /safe daemon restart marker/u);
    assert.match(saved, /"status": 47/u);
    assert.match(saved, /"status": 7/u);
    assert.match(saved, /"run": "123"/u);
    assert.doesNotMatch(saved, /CANARY_|eyJhbG|https:\/\//iu);
    if (scenario === "timeout") {
      assert.match(saved, /"timedOut": true/u);
      const pid = Number(readFileSync(pidFile, "utf8"));
      assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
    }
  }
});
