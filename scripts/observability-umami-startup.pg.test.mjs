// @ts-check
// Real pinned PostgreSQL startup barrier; no Umami app, foreign stand or private error output.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { z } from "zod";

const requireBackend = createRequire(
  new URL("../apps/backend/package.json", import.meta.url),
);
/* oxlint-disable typescript/no-unsafe-type-assertion -- owning app supplies container and wait-strategy types. */
const { PostgreSqlContainer } =
  /** @type {typeof import("../apps/backend/test/support/proof-dependencies.js")} */ (
    requireBackend("@testcontainers/postgresql")
  );
// The factory returns the exact strategy type accepted by the owning app's container.
const { Wait } =
  /** @type {{Wait: {forLogMessage: (message: string) => Parameters<InstanceType<typeof PostgreSqlContainer>["withWaitStrategy"]>[0]}}} */ (
    requireBackend("testcontainers")
  );
/* oxlint-enable typescript/no-unsafe-type-assertion */
const PG_STARTUP_MILLISECONDS = 60_000;
const PG_CLEANUP_MILLISECONDS = 1_000;
const PYTHON_COMMAND_MILLISECONDS = 5_000;
const FIXTURE_MILLISECONDS = 90_000;
const INIT_BARRIER_POLL_SECONDS = 0.05;
const INIT_BARRIER_POLL_ATTEMPTS = 600;
const SERVER_POLL_MILLISECONDS = 50;
const SERVER_WAIT_MILLISECONDS = 10_000;
const INFLIGHT_SLEEP_SECONDS = 15;
const TCP_PROBE = [
  "pg_isready",
  "-h",
  "127.0.0.1",
  "-p",
  "5432",
  "-t",
  "1",
  "-U",
  "pilot_bootstrap",
  "-d",
  "postgres",
];
const config = new URL("../infra/observability/umami/", import.meta.url);
const lockSchema = z.object({
  images: z.object({
    postgres: z.string().regex(/^postgres:16\.13-alpine@sha256:[a-f0-9]{64}$/u),
  }),
});

function productionProbe() {
  const script = `import sys,json,tempfile,pathlib
sys.path.insert(0,sys.argv[1])
import runtime,prepare
class Captured(Exception): pass
def capture(compose,args,**kwargs):
 with tempfile.TemporaryDirectory() as temporary:
  output=pathlib.Path(temporary)/'owned'
  prepare.prepare(output)
  print(json.dumps({'args':args,'sql':(output/'init.sql').read_text(),'health':json.loads((output/'compose.json').read_text())['services']['db']['healthcheck']['test']}))
 raise Captured()
runtime.invoke=capture
try: runtime.await_database([])
except Captured: pass
`;
  const result = spawnSync(
    "python3",
    [
      "-c",
      script,
      fileURLToPath(new URL("./observability-umami", import.meta.url)),
    ],
    {
      encoding: "utf8",
      timeout: PYTHON_COMMAND_MILLISECONDS,
      maxBuffer: 16_384,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    },
  );
  assert.equal(result.status, 0, "bounded readiness command capture failed");
  const captured = z
    .object({
      args: z.array(z.string()).min(5),
      sql: z.string().max(4096),
      health: z.array(z.string()),
    })
    .parse(JSON.parse(result.stdout));
  const { args } = captured;
  assert.deepEqual(args.slice(0, 3), ["exec", "-T", "db"]);
  assert.equal(args[3], "pg_isready");
  return { probe: args.slice(3), sql: captured.sql, health: captured.health };
}

// Controlled initialization checkpoint: PostgreSQL's temporary server is live; final startup has not occurred.
test(
  "persistent-server readiness rejects the pinned image's transient init checkpoint",
  { timeout: FIXTURE_MILLISECONDS },
  async (context) => {
    const lock = lockSchema.parse(
      JSON.parse(await readFile(new URL("inputs.lock.json", config), "utf8")),
    );
    const inputs = productionProbe();
    const barrier = `#!/bin/sh
set -eu
printf 'PILOT_INIT_BARRIER_READY\\n'
attempt=0
while [ ! -e /tmp/pilot-init-release ]; do
 attempt=$((attempt + 1))
 if [ "$attempt" -ge ${INIT_BARRIER_POLL_ATTEMPTS} ]; then exit 1; fi
 sleep ${INIT_BARRIER_POLL_SECONDS}
done
`;
    const container = await new PostgreSqlContainer(lock.images.postgres)
      .withUsername("pilot_bootstrap")
      .withPassword(randomBytes(24).toString("hex"))
      .withDatabase("postgres")
      .withResourcesQuota({ memory: 0.5, cpu: 0.5 })
      .withCopyContentToContainer([
        {
          content: barrier,
          target: "/docker-entrypoint-initdb.d/001-pilot-barrier.sh",
          mode: 0o755,
        },
        { content: inputs.sql, target: "/tmp/pilot-init.sql", mode: 0o600 },
        {
          content: `SET application_name='pilot-startup-inflight'; SELECT pg_sleep(${INFLIGHT_SLEEP_SECONDS});`,
          target: "/tmp/pilot-inflight.sql",
          mode: 0o600,
        },
      ])
      .withWaitStrategy(Wait.forLogMessage("PILOT_INIT_BARRIER_READY"))
      .withStartupTimeout(PG_STARTUP_MILLISECONDS)
      .start()
      .catch(() => {
        throw new Error("owned PostgreSQL startup acquisition failed");
      });
    /** @type {string | undefined} */
    let failureReason;
    let cleanupFailed = false;
    try {
      const unix = await container.exec([
        "pg_isready",
        "-t",
        "1",
        "-U",
        "pilot_bootstrap",
        "-d",
        "postgres",
      ]);
      const tcp = await container.exec(TCP_PROBE);
      assert.equal(
        unix.exitCode,
        0,
        "controlled checkpoint must expose transient Unix socket",
      );
      assert.notEqual(
        tcp.exitCode,
        0,
        "transient init server must not accept TCP",
      );
      const probe = await container.exec(inputs.probe);
      if (probe.exitCode === 0)
        failureReason =
          "production readiness accepted transient init server (exit 0)";
      const psql = [
        "psql",
        "-X",
        "-qAt",
        "-U",
        "pilot_bootstrap",
        "-d",
        "postgres",
        "-v",
        "ON_ERROR_STOP=1",
      ];
      const inflight = container.exec([
        "sh",
        "-c",
        'exec "$@" < /tmp/pilot-inflight.sql',
        "sh",
        ...psql,
      ]);
      const inflightDeadline = performance.now() + SERVER_WAIT_MILLISECONDS;
      while (true) {
        const active = await container.exec([
          ...psql,
          "-c",
          "SELECT count(*) FROM pg_stat_activity WHERE application_name='pilot-startup-inflight' AND wait_event='PgSleep'",
        ]);
        if (active.exitCode === 0 && active.stdout.trim() === "1") break;
        assert.ok(
          performance.now() < inflightDeadline,
          "bounded transient query checkpoint",
        );
        // deterministic-test-allow duration-wait: poll owned PostgreSQL state until the monotonic checkpoint deadline, with container cleanup in finally.
        await delay(SERVER_POLL_MILLISECONDS);
      }
      assert.equal(
        (await container.exec(["touch", "/tmp/pilot-init-release"])).exitCode,
        0,
      );
      assert.notEqual(
        (await inflight).exitCode,
        0,
        "transient connection must be interrupted by init restart",
      );
      const readyDeadline = performance.now() + SERVER_WAIT_MILLISECONDS;
      while ((await container.exec(TCP_PROBE)).exitCode !== 0) {
        assert.ok(
          performance.now() < readyDeadline,
          "bounded persistent server checkpoint",
        );
        // deterministic-test-allow duration-wait: poll owned PostgreSQL state until the monotonic checkpoint deadline, with container cleanup in finally.
        await delay(SERVER_POLL_MILLISECONDS);
      }
      assert.equal(
        (await container.exec(inputs.probe)).exitCode,
        0,
        "production readiness accepts final server",
      );
      const role = await container.exec([
        "sh",
        "-c",
        'exec "$@" < /tmp/pilot-init.sql',
        "sh",
        ...psql,
      ]);
      assert.equal(
        role.exitCode,
        0,
        "original private bootstrap SQL succeeds once on final server",
      );
      const roleProof = await container.exec([
        ...psql,
        "-c",
        "SELECT count(*) FROM pg_database d JOIN pg_roles r ON r.oid=d.datdba WHERE d.datname='umami' AND r.rolname='umami' AND NOT r.rolsuper AND NOT r.rolcreatedb AND NOT r.rolcreaterole",
      ]);
      assert.equal(roleProof.exitCode, 0);
      assert.equal(
        roleProof.stdout.trim(),
        "1",
        "isolated database owner retains least privilege",
      );
      context.diagnostic(
        "transient Unix accepts; TCP refuses; init restart interrupts active SQL; persistent TCP accepts and original role SQL succeeds once",
      );
      if (failureReason === undefined)
        assert.deepEqual(
          inputs.health,
          ["CMD", ...inputs.probe],
          "health and runtime readiness share one endpoint",
        );
    } catch {
      failureReason = "controlled startup or private role probe failed";
    } finally {
      const stopped = await Promise.allSettled([
        container.stop({
          timeout: PG_CLEANUP_MILLISECONDS,
          remove: true,
          removeVolumes: true,
        }),
      ]);
      cleanupFailed = stopped.some((result) => result.status === "rejected");
    }
    if (cleanupFailed)
      throw new Error("owned PostgreSQL startup cleanup failed");
    if (failureReason !== undefined) throw new Error(failureReason);
  },
);
