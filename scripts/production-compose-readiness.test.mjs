// @ts-check
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

test("production smoke waits for TCP SQL before creating its first database", () => {
  const result = runSmoke("starting");
  assert.equal(result.status, 42, result.output);
  assert.match(result.events, /tcp-unavailable\nsql-ready\ncreatedb\n/);
  assert.equal((result.events.match(/cleanup/g) ?? []).length, 2);
});

test("production smoke stops and cleans up when PostgreSQL stays Unix-only", () => {
  const result = runSmoke("unix-only");
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /Foundation PostgreSQL did not answer TCP SQL/);
  assert.doesNotMatch(result.events, /createdb/);
  assert.equal((result.events.match(/tcp-unavailable/g) ?? []).length, 30);
  assert.equal((result.events.match(/cleanup/g) ?? []).length, 2);
});

test("failed smoke saves worker State and health probe output before shutdown", () => {
  const result = runSmoke("starting");
  assert.equal(result.status, 42, result.output);
  assert.match(result.state, /"Status":"unhealthy"/);
  assert.match(result.state, /startup probe failed/);
  assert.match(result.workerLogs, /forced worker startup failure/);
  assert.match(result.output, /startup probe failed/);
  assert.match(result.events, /inspect-state\nworker-logs\ncleanup\ncleanup\n/);
});

/** @param {string} scenario */
function runSmoke(scenario) {
  const fixture = mkdtempSync(join(tmpdir(), "production-readiness-test-"));
  const eventsPath = join(fixture, "events");
  writeFileSync(eventsPath, "");
  writeFileSync(
    join(fixture, "docker"),
    `#!/bin/bash
set -eu
case "$*" in
  *" exec -T postgres "*)
    if [[ "$*" == *createdb* ]]; then
      if [[ ! -f "$READINESS_FIXTURE/ready" ]]; then
        echo 'createdb: Unix socket disappeared during init-server shutdown' >&2
        exit 1
      fi
      echo createdb >>"$READINESS_FIXTURE/events"
      exit 42 # Stop after the boundary under test; do not run the application scenario.
    fi
    if [[ "$*" != *"--host 127.0.0.1"* || "$*" != *"select 1"* ]]; then
      echo 'Probe must execute SQL over TCP' >&2
      exit 1
    fi
    if [[ "$READINESS_SCENARIO" == unix-only || ! -f "$READINESS_FIXTURE/attempted" ]]; then
      touch "$READINESS_FIXTURE/attempted"
      echo tcp-unavailable >>"$READINESS_FIXTURE/events"
      exit 2 # The temporary init-server accepts Unix sockets only.
    fi
    touch "$READINESS_FIXTURE/ready"
    echo sql-ready >>"$READINESS_FIXTURE/events"
    echo 1
    ;;
  *" ps --all --quiet"*) echo worker-fixture ;;
  "inspect --format "*)
    if [[ "$*" == *"json .State"* ]]; then
      echo inspect-state >>"$READINESS_FIXTURE/events"
      echo '{"Status":"exited","ExitCode":23,"Health":{"Status":"unhealthy","Log":[{"ExitCode":1,"Output":"startup probe failed"}]}}'
    else
      echo exited:unhealthy
    fi
    ;;
  "logs --tail 100 worker-fixture")
    echo worker-logs >>"$READINESS_FIXTURE/events"
    echo 'forced worker startup failure'
    ;;
  *" down "*) echo cleanup >>"$READINESS_FIXTURE/events" ;;
  "image inspect "*) echo sha256:fixture ;;
esac
`,
    { mode: 0o755 },
  );
  // The TLS and image setup are outside this readiness boundary.
  writeFileSync(
    join(fixture, "openssl"),
    '#!/bin/bash\nfor arg in "$@"; do case "$arg" in *.pem) touch "$arg" ;; esac; done\n',
    { mode: 0o755 },
  );
  writeFileSync(join(fixture, "sleep"), "#!/bin/bash\nexit 0\n", {
    mode: 0o755,
  });
  try {
    const result = spawnSync(
      "/bin/bash",
      ["scripts/production-compose-smoke.sh"],
      {
        encoding: "utf8",
        timeout: 10_000,
        env: {
          ...process.env,
          PATH: `${fixture}:${process.env["PATH"] ?? ""}`,
          TMPDIR: fixture,
          READINESS_FIXTURE: fixture,
          READINESS_SCENARIO: scenario,
          PRODUCTION_SMOKE_ARTIFACT_DIR: join(fixture, "artifacts"),
        },
      },
    );
    assert.ifError(result.error);
    return {
      status: result.status,
      output: result.stdout + result.stderr,
      events: readFileSync(eventsPath, "utf8"),
      state: readOptional(
        join(fixture, "artifacts", "worker-fixture-state.json"),
      ),
      workerLogs: readOptional(
        join(fixture, "artifacts", "worker-fixture.log"),
      ),
    };
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}

/** @param {string} path */
function readOptional(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}
