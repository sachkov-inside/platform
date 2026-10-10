// @ts-check
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { spawnOwned, stopOwned } from "./owned-process.mjs";

const effectiveHealthcheck =
  '{"Test":["CMD","node","worker-healthcheck.js"],"Interval":30000000000,"Timeout":3000000000,"Retries":2}';

test("production worker health observes unhealthy then healthy under the effective policy (Bash process adapter)", async (t) => {
  const result = await runHealth("valid");
  t.diagnostic(
    `Bash exit ${String(result.status)}; ${result.stderr}; ${result.stdout}; ${result.trace
      .split("\n")
      .filter((event) => /^(observed|smoke-complete|cleanup)/u.test(event))
      .join(", ")}`,
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.doesNotMatch(result.stderr, /value too great for base/u);
  for (const expected of ["unhealthy", "healthy"]) {
    for (const worker of [
      "assets",
      "avatars",
      "videos",
      "billing",
      "notifications",
    ])
      assert.ok(
        result.trace.includes(`66 ${worker} ${expected}\n`),
        result.trace,
      );
    assert.ok(result.trace.includes(`observed ${expected}\n`), result.trace);
  }
  assert.match(result.trace, /smoke-complete\ncleanup\ncleanup\n$/u);
});

for (const [name, configuration] of [
  ["malformed JSON", "{"],
  [
    "display duration",
    '{"Test":["CMD","probe"],"Interval":"30s","Timeout":3000000000,"Retries":2}',
  ],
  [
    "missing timeout",
    '{"Test":["CMD","probe"],"Interval":30000000000,"Retries":2}',
  ],
  [
    "zero interval",
    '{"Test":["CMD","probe"],"Interval":0,"Timeout":3000000000,"Retries":2}',
  ],
  [
    "negative interval",
    '{"Test":["CMD","probe"],"Interval":-1,"Timeout":3000000000,"Retries":2}',
  ],
  [
    "zero retries",
    '{"Test":["CMD","probe"],"Interval":30000000000,"Timeout":3000000000,"Retries":0}',
  ],
  [
    "fractional retries",
    '{"Test":["CMD","probe"],"Interval":30000000000,"Timeout":3000000000,"Retries":1.5}',
  ],
  [
    "disabled test",
    '{"Test":["NONE"],"Interval":30000000000,"Timeout":3000000000,"Retries":2}',
  ],
  [
    "overflowing window",
    '{"Test":["CMD","probe"],"Interval":9007199254740991,"Timeout":3000000000,"Retries":2}',
  ],
  ["null configuration", "null"],
]) {
  test(`production worker health rejects ${name} before reaching smoke success (Bash process adapter)`, async () => {
    const result = await runHealth("invalid-config", configuration);
    assert.equal(result.status, 1, result.stderr + result.trace);
    assert.match(result.stderr, /Invalid Docker healthcheck for assets/u);
    assert.doesNotMatch(result.trace, /observed|smoke-complete/u);
    assert.match(result.trace, /cleanup\ncleanup\n$/u);
  });
}

test("production worker health rejects a failed config inspect even when cleanup succeeds (Bash process adapter)", async () => {
  const result = await runHealth("inspect-failure-cleanup-success");
  assert.equal(result.status, 71, result.stderr + result.trace);
  assert.match(result.stderr, /primary health config inspect failure/u);
  assert.doesNotMatch(result.trace, /observed|smoke-complete/u);
  assert.match(result.trace, /cleanup\ncleanup\n$/u);
});

for (const [scenario, status, diagnostic] of /** @type {const} */ ([
  ["inspect-failure", 71, /primary health config inspect failure/u],
  ["state-failure", 72, /primary worker state inspect failure/u],
  ["ps-failure", 53, /primary worker container lookup failure/u],
  ["missing-container", 1, /Missing production worker container: assets/u],
  ["invalid-state", 1, /Invalid health state for production worker assets/u],
])) {
  test(`production worker health preserves ${scenario} through owning cleanup (Bash process adapter)`, async () => {
    const result = await runHealth(scenario);
    assert.equal(result.status, status, result.stderr + result.trace);
    assert.match(result.stderr, diagnostic);
    assert.doesNotMatch(result.trace, /observed|smoke-complete/u);
    assert.match(result.trace, /cleanup\ncleanup\n$/u);
    assert.match(
      result.stderr,
      /Failed to remove production runtime smoke resources/u,
    );
  });
}

test("production worker health stops at the existing observation bound if states never match (Bash process adapter)", async () => {
  const result = await runHealth("stalled");
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /Workers did not reach health state unhealthy/u);
  assert.equal((result.trace.match(/sleep 1\n/gu) ?? []).length, 68);
  assert.doesNotMatch(result.trace, /observed|smoke-complete/u);
  assert.match(result.trace, /cleanup\ncleanup\n$/u);
});

test("production worker health derives its bound from fractional-second effective JSON durations (Bash process adapter)", async () => {
  const result = await runHealth(
    "stalled",
    '{"Test":["CMD-SHELL","probe"],"Interval":5500000000,"Timeout":800000000,"Retries":3}',
  );
  assert.equal(result.status, 1, result.stderr);
  // Three 6.3-second probe windows round to 19 seconds, then retain two observation attempts.
  assert.equal((result.trace.match(/sleep 1\n/gu) ?? []).length, 21);
  assert.doesNotMatch(result.trace, /observed|smoke-complete/u);
  assert.match(result.trace, /cleanup\ncleanup\n$/u);
});

/** @param {string} scenario @param {string} [configuration] */
async function runHealth(scenario, configuration = effectiveHealthcheck) {
  const fixture = mkdtempSync(join(tmpdir(), "inside-worker-health-"));
  try {
    const script = readFileSync("scripts/production-compose-smoke.sh", "utf8");
    const cleanup = script.slice(
      script.indexOf("cleanup() {"),
      script.indexOf("\nwrite_runtime_configuration()"),
    );
    const health = script.slice(
      script.indexOf("wait_for_worker_health() {"),
      script.indexOf("\nwait_for_material_asset_table_lock()"),
    );
    assert.ok(cleanup.startsWith("cleanup() {"));
    assert.ok(health.startsWith("wait_for_worker_health() {"));
    mkdirSync(join(fixture, "runtime"));
    mkdirSync(join(fixture, "foundation"));
    writeFileSync(join(fixture, "trace"), "");
    writeFileSync(join(fixture, "clock"), "0\n");
    writeFileSync(
      join(fixture, "entrypoint"),
      `#!/bin/bash
set -euo pipefail
application_compose=(docker compose --project-name inside-worker-health-owned)
foundation_compose=(docker compose --project-name inside-worker-health-foundation-owned)
application_workers=(assets avatars videos billing notifications)
production_smoke_poll_interval_seconds=1
runtime_config_dir="$HEALTH_FIXTURE/runtime"
foundation_config_dir="$HEALTH_FIXTURE/foundation"
artifact_dir="$HEALTH_FIXTURE/artifacts"
wrong_release_container=owned-wrong-release
contender_container=owned-contender
drain_lock_container=owned-drain-lock
sale_configuration_container=owned-sale-configuration
backend_image=owned-backend
next_backend_image=owned-next-backend
web_image=owned-web
docker() {
  case "$*" in
    *" ps --quiet "*)
      if [[ "$HEALTH_SCENARIO" == ps-failure ]]; then echo 'primary worker container lookup failure' >&2; return 53; fi
      if [[ "$HEALTH_SCENARIO" == missing-container ]]; then return; fi
      for worker in "$@"; do :; done
      printf '%s\\n' "$worker"
      ;;
    *".Config.Healthcheck"*)
      if [[ "$HEALTH_SCENARIO" == inspect-failure || "$HEALTH_SCENARIO" == inspect-failure-cleanup-success ]]; then echo 'primary health config inspect failure' >&2; return 71; fi
      if [[ "$*" == *"json .Config.Healthcheck"* ]]; then
        printf '%s\\n' "$HEALTH_CONFIGURATION"
      else
        printf '%s\\n' '30s 3s 2' # The actual CI38006396308 display input (#1321).
      fi
      ;;
    *".State.Health.Status"*)
      if [[ "$HEALTH_SCENARIO" == state-failure ]]; then echo 'primary worker state inspect failure' >&2; return 72; fi
      if [[ "$HEALTH_SCENARIO" == invalid-state ]]; then echo '<no value>'; return; fi
      local now state
      read -r now <"$HEALTH_FIXTURE/clock"
      if [[ "$HEALTH_SCENARIO" == stalled ]]; then state=healthy; elif [[ "$HEALTH_SCENARIO" != valid ]] || ((now >= 66)); then state=$fixture_expected; elif [[ "$fixture_expected" == unhealthy ]]; then state=healthy; else state=unhealthy; fi
      printf '%s %s %s\\n' "$now" "$3" "$state" >>"$HEALTH_FIXTURE/trace"
      printf '%s\\n' "$state"
      ;;
    *" down "*)
      echo cleanup >>"$HEALTH_FIXTURE/trace"
      if [[ "$HEALTH_SCENARIO" != valid && "$HEALTH_SCENARIO" != stalled && "$HEALTH_SCENARIO" != invalid-config && "$HEALTH_SCENARIO" != inspect-failure-cleanup-success ]]; then return 79; fi
      ;;
  esac
}
export -f docker
sleep() {
  local now
  read -r now <"$HEALTH_FIXTURE/clock"
  printf 'sleep %s\\n' "$1" >>"$HEALTH_FIXTURE/trace"
  printf '%s\\n' "$((now + $1))" >"$HEALTH_FIXTURE/clock"
}
${cleanup}
${health}
fixture_expected=unhealthy
wait_for_worker_health unhealthy
echo 'observed unhealthy' >>"$HEALTH_FIXTURE/trace"
printf '0\\n' >"$HEALTH_FIXTURE/clock"
fixture_expected=healthy
wait_for_worker_health healthy
echo 'observed healthy' >>"$HEALTH_FIXTURE/trace"
echo smoke-complete >>"$HEALTH_FIXTURE/trace"
`,
    );
    const child = spawnOwned("/bin/bash", [join(fixture, "entrypoint")], {
      // This budget stops a stuck local adapter; virtual polling models the effective policy.
      signal: AbortSignal.timeout(10_000),
      env: {
        ...process.env,
        HEALTH_FIXTURE: fixture,
        HEALTH_SCENARIO: scenario,
        HEALTH_CONFIGURATION: configuration,
      },
    });
    try {
      let stdout = "";
      let stderr = "";
      child.stdout?.on(
        "data",
        /** @param {Buffer} chunk */ (chunk) => {
          stdout += chunk.toString();
        },
      );
      child.stderr?.on(
        "data",
        /** @param {Buffer} chunk */ (chunk) => {
          stderr += chunk.toString();
        },
      );
      /** @type {number | null} */
      const status = await new Promise((resolve, reject) => {
        child.once("close", resolve);
        child.once("error", reject);
      });
      return {
        status,
        stdout,
        stderr,
        trace: readFileSync(join(fixture, "trace"), "utf8"),
      };
    } finally {
      await stopOwned(child);
    }
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}
