// @ts-check
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { spawnOwned, stopOwned } from "./owned-process.mjs";

test("production cache-only selects pinned broker and edge images without dependency images (process adapter)", async () => {
  const result = await runAcquisition("cache-ready");
  assert.equal(result.status, 42, result.output + result.trace);
  assert.match(result.trace, /generated-env-files\n/u);
  assert.match(result.trace, /foundation-startup\n/u);
  assert.match(result.trace, /application-startup\n/u);
  assert.doesNotMatch(result.trace, /build|pull|image-remove/u);
});

test("production cache-only rejects a missing pinned input before build, pull or startup (process adapter)", async () => {
  const result = await runAcquisition("cache-missing-pinned");
  assert.equal(result.status, 32, result.output + result.trace);
  assert.match(
    result.output,
    /No such image: .*rabbitmq:4\.2\.4-alpine@sha256:/u,
  );
  assert.doesNotMatch(result.trace, /build|pull|startup|cleanup|image-remove/u);
});

test("production cache-only rejects the missing pinned edge input before startup (process adapter)", async () => {
  const result = await runAcquisition("cache-missing-caddy");
  assert.equal(result.status, 32, result.output + result.trace);
  assert.match(
    result.output,
    /No such image: .*caddy:2\.11\.4-alpine@sha256:/u,
  );
  assert.doesNotMatch(
    result.trace,
    /build|pull|startup|run-image|cleanup|image-remove/u,
  );
});

test("production cache-only rejects missing, malformed and foreign image identities (process adapter)", async () => {
  for (const scenario of [
    "cache-missing-id",
    "cache-malformed-id",
    "cache-duplicate-id",
    "cache-foreign-owner",
    "cache-malformed-source",
  ]) {
    const result = await runAcquisition(scenario);
    assert.equal(result.status, 64, scenario + result.output + result.trace);
    assert.doesNotMatch(
      result.trace,
      /build|pull|startup|run-image|cleanup|image-remove/u,
    );
  }
});

test("production cache-only rejects an ID that differs from its owned tag (process adapter)", async () => {
  const result = await runAcquisition("cache-wrong-id");
  assert.equal(result.status, 65, result.output + result.trace);
  assert.match(result.output, /image ID does not match its owned tag/u);
  assert.doesNotMatch(
    result.trace,
    /build|pull|startup|run-image|cleanup|image-remove/u,
  );
});

test("production cache-only rejects a foundation override with foreign resource authority (process adapter)", async () => {
  const result = await runAcquisition("cache-foreign-override");
  assert.equal(result.status, 65, result.output + result.trace);
  assert.match(result.output, /foundation override must contain only/u);
  assert.doesNotMatch(
    result.trace,
    /build|pull|startup|run-image|cleanup|image-remove/u,
  );
});

test("production cache-only preserves supplied Source and image identities without acquisition (process adapter)", async () => {
  const result = await runAcquisition("cache-ready");
  assert.equal(result.status, 42, result.output + result.trace);
  assert.match(
    result.trace,
    /PLATFORM_RELEASE_VERSION=v1\nPLATFORM_SOURCE_SHA=2222222222222222222222222222222222222222/u,
  );
  for (const id of ["a", "b", "c", "d"]) {
    assert.ok(result.trace.includes(`sha256:${id.repeat(64)}`), result.trace);
  }
  assert.equal((result.trace.match(/cleanup\n/gu) ?? []).length, 2);
  assert.doesNotMatch(
    result.trace,
    /build|pull|image-remove|shared-image-cleanup/u,
  );
  assert.match(result.trace, /foundation-startup\n/u);
  assert.match(result.trace, /application-startup\n/u);
});

test("production cache-only preserves primary failure when owned cleanup fails (process adapter)", async () => {
  const result = await runAcquisition("cache-cleanup-failure");
  assert.equal(result.status, 42, result.output + result.trace);
  assert.match(
    result.output,
    /Failed to remove production foundation smoke resources/u,
  );
  assert.equal((result.trace.match(/cleanup\n/gu) ?? []).length, 2);
  assert.doesNotMatch(
    result.trace,
    /build|pull|image-remove|shared-image-cleanup/u,
  );
});

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
  const cacheOnly = scenario.startsWith("cache-");
  const owner = "inside-platform-production-smoke-cache-fixture";
  const backend = `sha256:${"a".repeat(64)}`;
  const nextBackend = `sha256:${"b".repeat(64)}`;
  const web = `sha256:${"c".repeat(64)}`;
  const foundation = `sha256:${"d".repeat(64)}`;
  const override = join(fixture, "foundation.compose.yaml");
  writeFileSync(
    override,
    `services:\n  postgres:\n    image: ${foundation}\n    pull_policy: never\n  pgbackrest:\n    image: ${foundation}\n    pull_policy: never\n  restore:\n    image: ${foundation}\n    pull_policy: never\n` +
      (scenario === "cache-foreign-override"
        ? "    volumes:\n      - foreign-owner-data:/var/lib/postgresql\n"
        : ""),
  );
  const tracePath = join(fixture, "trace");
  writeFileSync(tracePath, "");
  writeFileSync(join(fixture, "clock"), "0\n");
  const rabbitmq = imageFrom("compose.production.yaml", "rabbitmq");
  const caddy = imageFrom(
    "scripts/fixtures/production-runtime/compose.smoke.yaml",
    "caddy",
  );
  writeFileSync(
    join(fixture, "compose.json"),
    JSON.stringify({
      services: {
        api: { image: backend },
        mcp: { image: backend },
        migrations: { image: backend },
        "caddy-smoke": { image: caddy },
        web: { image: web },
        rabbitmq: { image: rabbitmq },
      },
    }),
  );
  writeFileSync(
    join(fixture, "docker"),
    `#!/bin/bash
set -eu
if [[ "$ACQUISITION_SCENARIO" == cache-* ]]; then
  case "$*" in
    build*|*" --build "*) echo build >>"$ACQUISITION_FIXTURE/trace" ;;
    *" pull "*) echo pull >>"$ACQUISITION_FIXTURE/trace" ;;
    *" up "*)
      if [[ "$*" != *" --no-build --pull never "* ]]; then
        echo unsafe-startup >>"$ACQUISITION_FIXTURE/trace"
        exit 66
      fi
      if [[ "$*" == *" --wait postgres" ]]; then
        cat "$PLATFORM_RELEASE_ENV_FILE" >>"$ACQUISITION_FIXTURE/trace"
        echo foundation-startup >>"$ACQUISITION_FIXTURE/trace"
      else
        echo application-startup >>"$ACQUISITION_FIXTURE/trace"
        exit 42 # Stop before application assertions; this is an adapter contract.
      fi
      ;;
    "image rm"*) echo image-remove >>"$ACQUISITION_FIXTURE/trace" ;;
    *" down --rmi "*) echo shared-image-cleanup >>"$ACQUISITION_FIXTURE/trace" ;;
    run*|create*)
      if [[ "$2" != --pull=never ]]; then
        echo unsafe-image-startup >>"$ACQUISITION_FIXTURE/trace"
        exit 66
      fi
      for arg in "$@"; do
        case "$arg" in sha256:*) echo "run-image $arg" >>"$ACQUISITION_FIXTURE/trace" ;; esac
      done
      ;;
  esac
fi
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
  *" config --format json"|*" config --images rabbitmq caddy-smoke")
    # Compose resolves the Source-generated synthetic env files before returning its model.
    for name in runtime migrations api mcp material-assets-worker profile-avatars-worker video-deletions-worker billing-worker notifications-worker web; do
      test -s "$PLATFORM_CONFIG_DIR/$name.env"
    done
    echo generated-env-files >>"$ACQUISITION_FIXTURE/trace"
    if [[ "$*" == *" config --format json" ]]; then
      cat "$ACQUISITION_FIXTURE/compose.json"
    elif [[ "$ACQUISITION_SCENARIO" == cache-* ]]; then
      # Saved Compose 2.40.3 output includes dependencies before the selected pinned inputs.
      printf '%s\\n' "$PRODUCTION_SMOKE_BACKEND_IMAGE" "$PRODUCTION_SMOKE_BACKEND_IMAGE" "$PRODUCTION_SMOKE_BACKEND_IMAGE" "$CADDY_IMAGE" "$PRODUCTION_SMOKE_WEB_IMAGE" "$RABBITMQ_IMAGE"
    else
      printf '%s\\n' "$RABBITMQ_IMAGE" "$CADDY_IMAGE"
    fi
    ;;
  *" config --images") printf '%s\\n' "$RABBITMQ_IMAGE" "$CADDY_IMAGE" ;;
  *" pull rabbitmq caddy-smoke")
    # Compose owns graph ordering; CI38000920757 on 2026-10-09 acquired Caddy first (#1316).
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
    if [[ "$ACQUISITION_SCENARIO" == cache-cleanup-failure && "$*" == *" --file infra/production/database/compose.yaml "* ]]; then exit 71; fi
    ;;
  "image inspect "*)
    if [[ "$ACQUISITION_SCENARIO" == cache-* ]]; then
      echo "inspect $3" >>"$ACQUISITION_FIXTURE/trace"
      if [[ ("$ACQUISITION_SCENARIO" == cache-missing-pinned && "$*" == *"$RABBITMQ_IMAGE"*) || ("$ACQUISITION_SCENARIO" == cache-missing-caddy && "$*" == *"$CADDY_IMAGE"*) ]]; then
        echo "No such image: $3" >&2
        exit 32
      fi
      if [[ "$ACQUISITION_SCENARIO" == cache-wrong-id ]]; then echo "$PRODUCTION_SMOKE_FOUNDATION_IMAGE"; exit 0; fi
      case "$3" in
        "$PRODUCTION_SMOKE_CACHE_OWNER-backend:v1") image_id="$PRODUCTION_SMOKE_BACKEND_IMAGE" ;;
        "$PRODUCTION_SMOKE_CACHE_OWNER-backend:v2") image_id="$PRODUCTION_SMOKE_NEXT_BACKEND_IMAGE" ;;
        "$PRODUCTION_SMOKE_CACHE_OWNER-web:v1") image_id="$PRODUCTION_SMOKE_WEB_IMAGE" ;;
        "$PRODUCTION_SMOKE_CACHE_OWNER-foundation:local") image_id="$PRODUCTION_SMOKE_FOUNDATION_IMAGE" ;;
        *) image_id="sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" ;;
      esac
      echo "resolved $image_id" >>"$ACQUISITION_FIXTURE/trace"
      echo "$image_id"
    else
      echo sha256:fixture
    fi
    ;;
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
  const inheritedEnvironment = {
    ...process.env,
    // Every default-mode adapter must also reject an inherited opt-in mode.
    PRODUCTION_SMOKE_CACHE_ONLY: "1",
  };
  const child = spawnOwned(
    "/bin/bash",
    ["scripts/production-compose-smoke.sh"],
    {
      // The budget stops a stuck adapter; the supervisor owns descendant cleanup.
      signal: AbortSignal.timeout(10_000),
      env: {
        ...inheritedEnvironment,
        PRODUCTION_SMOKE_CACHE_ONLY: cacheOnly ? "1" : "0",
        PATH: `${fixture}:${process.env["PATH"] ?? ""}`,
        TMPDIR: fixture,
        ACQUISITION_FIXTURE: fixture,
        ACQUISITION_SCENARIO: scenario,
        RABBITMQ_IMAGE: rabbitmq,
        CADDY_IMAGE: caddy,
        PRODUCTION_SMOKE_ARTIFACT_DIR: join(fixture, "artifacts"),
        ...(cacheOnly
          ? {
              PRODUCTION_SMOKE_CACHE_OWNER:
                scenario === "cache-foreign-owner" ? "inside-platform" : owner,
              PRODUCTION_SMOKE_SOURCE_SHA:
                scenario === "cache-malformed-source"
                  ? "not-a-source-sha"
                  : "2222222222222222222222222222222222222222",
              PRODUCTION_SMOKE_BACKEND_IMAGE:
                scenario === "cache-missing-id"
                  ? ""
                  : scenario === "cache-malformed-id"
                    ? "sha256:short"
                    : backend,
              PRODUCTION_SMOKE_NEXT_BACKEND_IMAGE:
                scenario === "cache-duplicate-id" ? backend : nextBackend,
              PRODUCTION_SMOKE_WEB_IMAGE: web,
              PRODUCTION_SMOKE_FOUNDATION_IMAGE: foundation,
              PRODUCTION_SMOKE_FOUNDATION_OVERRIDE: override,
            }
          : {}),
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
