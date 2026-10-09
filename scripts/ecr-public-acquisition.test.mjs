// @ts-check
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { spawnOwned, stopOwned } from "./owned-process.mjs";

test("production acquisition admits fast ECR pulls at the anonymous provider rate (process adapter)", async (t) => {
  const result = await runAcquisition("quota");
  t.diagnostic(result.trace);
  assert.equal(result.status, 42, result.output + result.trace);
  assert.match(
    result.trace,
    /0 start rabbitmq .*\n1 complete rabbitmq\n1001 start caddy-smoke .*\n1002 complete caddy-smoke\n/u,
  );
  assert.match(result.trace, /application-start\ncleanup\ncleanup\n$/u);
  assert.match(
    result.output,
    /rabbitmq:4\.2\.4-alpine@sha256:83522278ca69414e4895b3ea3c0f943c63ad316c063f9cda9c32fd42fe800f47/u,
  );
});

test("production acquisition retains an image-input error and stops before another pull (process adapter)", async (t) => {
  const result = await runAcquisition("invalid-input");
  t.diagnostic(result.trace);
  assert.equal(result.status, 31, result.output);
  assert.match(
    result.output,
    /manifest unknown: public\.ecr\.aws\/docker\/library\/rabbitmq:4\.2\.4-alpine@sha256:/u,
  );
  assert.doesNotMatch(result.output, /toomanyrequests/u);
  assert.equal((result.trace.match(/ start /gu) ?? []).length, 1);
  assert.doesNotMatch(result.trace, /application-start|start caddy-smoke/u);
  assert.match(result.trace, /cleanup\ncleanup\n$/u);
});

test("production acquisition preserves external throttling after admission even when cleanup fails (process adapter)", async (t) => {
  const result = await runAcquisition("external-pressure");
  t.diagnostic(result.trace);
  assert.equal(result.status, 29, result.output);
  assert.match(
    result.output,
    /toomanyrequests: Rate exceeded: public\.ecr\.aws\/docker\/library\/caddy:.* at 1001 ms/u,
  );
  assert.match(
    result.output,
    /Failed to remove production runtime smoke resources/u,
  );
  assert.equal((result.trace.match(/ start /gu) ?? []).length, 2);
  assert.doesNotMatch(result.trace, /application-start/u);
  assert.match(result.trace, /cleanup\ncleanup\n$/u);
});

/** @param {string} scenario */
async function runAcquisition(scenario) {
  const fixture = mkdtempSync(join(tmpdir(), "inside-ecr-acquisition-"));
  const tracePath = join(fixture, "trace");
  writeFileSync(tracePath, "");
  writeFileSync(join(fixture, "clock"), "0\n");
  const rabbitmq = imageFrom("compose.production.yaml", "rabbitmq");
  const caddy = imageFrom(
    "scripts/fixtures/production-runtime/compose.smoke.yaml",
    "caddy",
  );
  writeFileSync(
    join(fixture, "docker"),
    `#!/bin/bash
set -eu
acquire() {
  service=$1
  image=$2
  now=$(cat "$ACQUISITION_FIXTURE/clock")
  printf '%s start %s %s\\n' "$now" "$service" "$image" >>"$ACQUISITION_FIXTURE/trace"
  if [[ "$ACQUISITION_SCENARIO" == invalid-input && "$service" == rabbitmq ]]; then
    printf 'manifest unknown: %s at %s ms\\n' "$image" "$now" >&2
    exit 31
  fi
  if [[ "$ACQUISITION_SCENARIO" == external-pressure && "$service" == caddy-smoke ]]; then
    printf 'toomanyrequests: Rate exceeded: %s at %s ms\\n' "$image" "$now" >&2
    exit 29
  fi
  if [[ -f "$ACQUISITION_FIXTURE/last-start" ]]; then
    previous=$(cat "$ACQUISITION_FIXTURE/last-start")
    if ((now - previous < 1000)); then
      printf 'toomanyrequests: Rate exceeded: %s at %s ms\\n' "$image" "$now" >&2
      exit 29
    fi
  fi
  printf '%s\\n' "$now" >"$ACQUISITION_FIXTURE/last-start"
  now=$((now + 1)) # Cached layers complete in one virtual millisecond.
  printf '%s\\n' "$now" >"$ACQUISITION_FIXTURE/clock"
  printf '%s complete %s\\n' "$now" "$service" >>"$ACQUISITION_FIXTURE/trace"
}
case "$*" in
  *" config --images rabbitmq caddy-smoke") printf '%s\\n' "$RABBITMQ_IMAGE" "$CADDY_IMAGE" ;;
  *" config --images") printf '%s\\n' "$RABBITMQ_IMAGE" "$CADDY_IMAGE" ;;
  *" pull rabbitmq caddy-smoke")
    # Compose owns graph ordering; the observed historical graph acquired Caddy first.
    acquire caddy-smoke "$CADDY_IMAGE"
    acquire rabbitmq "$RABBITMQ_IMAGE"
    ;;
  *" pull rabbitmq") acquire rabbitmq "$RABBITMQ_IMAGE" ;;
  *" pull caddy-smoke") acquire caddy-smoke "$CADDY_IMAGE" ;;
  *" exec -T postgres "*) echo 1 ;;
  *" up --detach --wait")
    echo application-start >>"$ACQUISITION_FIXTURE/trace"
    exit 42 # Stop at startup: this contract never runs application assertions.
    ;;
  *" down "*)
    echo cleanup >>"$ACQUISITION_FIXTURE/trace"
    if [[ "$ACQUISITION_SCENARIO" == external-pressure ]]; then exit 71; fi
    ;;
  "image inspect "*) echo sha256:fixture ;;
esac
`,
    { mode: 0o755 },
  );
  writeFileSync(
    join(fixture, "openssl"),
    '#!/bin/bash\nfor arg in "$@"; do case "$arg" in *.pem) touch "$arg" ;; esac; done\n',
    { mode: 0o755 },
  );
  writeFileSync(
    join(fixture, "sleep"),
    `#!/bin/bash
set -eu
test "$1" = 1
now=$(cat "$ACQUISITION_FIXTURE/clock")
printf '%s\\n' "$((now + 1000))" >"$ACQUISITION_FIXTURE/clock"
`,
    { mode: 0o755 },
  );
  const child = spawnOwned(
    "/bin/bash",
    ["scripts/production-compose-smoke.sh"],
    {
      // The budget stops a stuck adapter; the supervisor owns descendant cleanup.
      signal: AbortSignal.timeout(10_000),
      env: {
        ...process.env,
        PATH: `${fixture}:${process.env["PATH"] ?? ""}`,
        TMPDIR: fixture,
        ACQUISITION_FIXTURE: fixture,
        ACQUISITION_SCENARIO: scenario,
        RABBITMQ_IMAGE: rabbitmq,
        CADDY_IMAGE: caddy,
        PRODUCTION_SMOKE_ARTIFACT_DIR: join(fixture, "artifacts"),
      },
    },
  );
  try {
    let output = "";
    /** @param {Buffer} chunk */
    const capture = (chunk) => {
      output += chunk.toString();
    };
    child.stdout?.on("data", capture);
    child.stderr?.on("data", capture);
    /** @type {number | null} */
    const status = await new Promise((resolve, reject) => {
      child.once("close", resolve);
      child.once("error", reject);
    });
    return {
      status,
      output,
      trace: readFileSync(tracePath, "utf8"),
    };
  } finally {
    await stopOwned(child);
    rmSync(fixture, { recursive: true, force: true });
  }
}

/** @param {string} path @param {string} image */
function imageFrom(path, image) {
  const reference = readFileSync(path, "utf8")
    .split("\n")
    .find((line) =>
      line.includes(`image: public.ecr.aws/docker/library/${image}:`),
    )
    ?.trim()
    .slice("image: ".length);
  assert.ok(reference, `${path} must select the official ${image} input`);
  return reference;
}
