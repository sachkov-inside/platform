import { runOwnedCommandSync } from "../support/owned-command.js";
import {
  chmodSync,
  existsSync,
  readdirSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";
// @ts-expect-error The release contract is an untyped JavaScript module.
import { migrationsIdentity } from "../../scripts/release-contract.mjs";

const root = path.resolve("../..");
const smoke = path.join(root, "apps/telegram/scripts/production-smoke.sh");
const previousSha = "b".repeat(40);
const migrations = path.join(root, "apps/telegram/src/database/migrations");
const migrationCount = readdirSync(migrations).length;
const sourceSha = "a".repeat(40);
// The complete external-command cycle measured 6.69s under full-suite/Docker load.
// This deadline bounds a stuck script; individual corruption cases keep Vitest's default budget.
const runtimeProofBudgetMs = 30_000;

// External tools are the seam: execute the entire public smoke script, including its cleanup.
// The real Docker runtime proof remains separate; these adapters make corrupt observations deterministic.
const dockerAdapter = String.raw`
set -euo pipefail
printf '%s\n' "$*" >>"$FIXTURES/docker.log"
case "$1" in
  build)
    while [[ "$#" -gt 0 ]]; do
      if [[ "$1" == --tag ]]; then printf '%s\n' "$2" >"$FIXTURES/candidate"; break; fi
      shift
    done ;;
  image)
    if [[ "$2" == inspect ]]; then
      read -r candidate <"$FIXTURES/candidate"
      for format in "$@"; do :; done
      if [[ "$format" == *revision* ]]; then
        if [[ "$3" == "$candidate" ]]; then
          if [[ "$SCENARIO" == image ]]; then printf '%040d\n' 0; else printf '%s\n' "$SOURCE_SHA"; fi
        else printf '%s\n' "$PREVIOUS_SHA"; fi
      elif [[ "$3" == "$candidate" ]]; then echo candidate-image-id
      else echo legacy-image-id; fi
    fi ;;
  inspect)
    read -r candidate <"$FIXTURES/candidate"
    read -r active <"$FIXTURES/active"
    if [[ "$active" == "$candidate" ]]; then echo candidate-image-id; else echo legacy-image-id; fi ;;
  compose)
    for argument in "$@"; do
      case "$argument" in
        up) printf '%s\n' "$TELEGRAM_IMAGE" >"$FIXTURES/active" ;;
        port) echo 127.0.0.1:45678 ;;
        ps) echo fixture-app ;;
        migrate)
          read -r candidate <"$FIXTURES/candidate"
          if [[ "$TELEGRAM_IMAGE" == "$candidate" ]]; then touch "$FIXTURES/upgraded"; fi ;;
      esac
    done ;;
  exec)
    if [[ "$3" == psql ]]; then
      read -r candidate <"$FIXTURES/candidate"
      read -r active <"$FIXTURES/active"
      for query in "$@"; do :; done
      case "$query" in
        'select count(*) from kysely_migration')
          if [[ -f "$FIXTURES/upgraded" ]]; then ls "$REPOSITORY_ROOT/apps/telegram/src/database/migrations" | wc -l | tr -d ' '
          else echo "$PREVIOUS_COUNT"; fi ;;
        'select name from kysely_migration order by name')
          applied=0
          for file in "$REPOSITORY_ROOT/apps/telegram/src/database/migrations/"*.ts; do
            if [[ -f "$FIXTURES/upgraded" || "$applied" -lt "$PREVIOUS_COUNT" ]]; then printf '%s\n' "$(basename "$file" .ts)"; fi
            applied=$((applied + 1))
          done
          if [[ "$SCENARIO" == ledger && "$active" == "$candidate" ]]; then echo unexpected-migration; fi ;;
        'select value from delivery_smoke_sentinel')
          if [[ "$SCENARIO" == sentinel && "$active" == "$candidate" ]]; then echo corrupted; else echo preserved; fi ;;
        'create table delivery_smoke_sentinel'*) ;;
        *) exit 1 ;;
      esac
    fi ;;
  pull|network|run|container) ;;
  *) exit 1 ;;
esac
`;

const ghAdapter = String.raw`
set -euo pipefail
printf '%s\n' "$*" >>"$FIXTURES/gh.log"
if [[ "$1 $2" == 'release list' ]]; then echo telegram-v50; exit 0; fi
[[ "$1 $2 $3" == 'release download telegram-v50' ]] || exit 1
while [[ "$#" -gt 0 ]]; do
  if [[ "$1" == --dir ]]; then destination="$2"; break; fi
  shift
done
cat >"$destination/release-manifest.json" <<JSON
{"schemaVersion":"inside.telegram.release-manifest.v1","version":"v50","source":{"repository":"$PREVIOUS_REPOSITORY","sha":"$PREVIOUS_SHA"},"migrations":{"identity":"$PREVIOUS_IDENTITY","count":$PREVIOUS_COUNT},"image":"ghcr.io/sachkov-inside/inside-telegram@sha256:1159e5f27ed6f12528ae383f1f379bfdc41780a1b37dafb72d9b35ff34d1b748"}
JSON
`;

const curlAdapter = String.raw`
set -euo pipefail
output=''
auth=false
while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --output|-o) output="$2"; shift ;;
    --request) auth=true ;;
  esac
  shift
done
if [[ "$auth" == true ]]; then
  printf '%s' '{"statusCode":401,"message":"Unauthorized"}' >"$output"
  printf 401
else printf '%s' '{"status":"ready"}'; fi
`;

const gitAdapter = String.raw`
[[ "$*" == 'rev-parse HEAD' ]] || exit 1
printf '%s\n' "$SOURCE_SHA"
`;

async function previousRelease(scenario: string) {
  // A forward release adds two migrations after the published one.
  const count = scenario === "forward" ? migrationCount - 2 : migrationCount;
  const identity =
    scenario === "history"
      ? `sha256:${"0".repeat(64)}`
      : ((await migrationsIdentity(migrations, count)) as { identity: string })
          .identity;
  return {
    PREVIOUS_COUNT: String(count),
    PREVIOUS_IDENTITY: identity,
    PREVIOUS_REPOSITORY:
      scenario === "manifest"
        ? "sachkov-inside/inside-telegram"
        : "sachkov-inside/platform",
  };
}

async function runSmoke(scenario: string) {
  const previous = await previousRelease(scenario);
  const fixture = mkdtempSync(
    path.join(tmpdir(), "telegram-runtime-contract-"),
  );
  try {
    const bin = path.join(fixture, "bin");
    mkdirSync(bin);
    for (const [name, body] of [
      ["docker", dockerAdapter],
      ["gh", ghAdapter],
      ["curl", curlAdapter],
      ["git", gitAdapter],
    ] as const) {
      const executable = path.join(bin, name);
      writeFileSync(executable, `#!/bin/bash\n${body}`);
      chmodSync(executable, 0o755);
    }
    const result = runOwnedCommandSync("/bin/bash", [smoke], {
      cwd: fixture,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}:${process.env["PATH"] ?? ""}`,
        TMPDIR: fixture,
        FIXTURES: fixture,
        REPOSITORY_ROOT: root,
        SCENARIO: scenario,
        SOURCE_SHA: sourceSha,
        PREVIOUS_SHA: previousSha,
        ...previous,
      },
      timeout: runtimeProofBudgetMs,
    });
    return {
      result,
      // A refused manifest stops the smoke before any Docker call.
      calls: existsSync(path.join(fixture, "docker.log"))
        ? readFileSync(path.join(fixture, "docker.log"), "utf8")
        : "",
      releases: readFileSync(path.join(fixture, "gh.log"), "utf8"),
    };
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}

describe("Telegram production runtime smoke", () => {
  it(
    "rolls back to the latest published release when the gateway allows it, with no rollback migration",
    async () => {
      const { result, calls, releases } = await runSmoke("valid");
      expect(result.status, result.stderr).toBe(0);
      expect(releases).toContain("release download telegram-v50");
      expect(result.stdout).toContain(
        "Telegram runtime transition and rollback to v50 passed",
      );
      expect(
        calls.split("\n").filter((call) => call.endsWith("migrate")),
      ).toHaveLength(2);
      expect(calls.slice(calls.lastIndexOf("stop app"))).not.toContain(
        "migrate",
      );
      expect(calls).toContain("container rm --force --volumes");
    },
    runtimeProofBudgetMs,
  );

  it(
    "proves the forward transition and skips the rollback the gateway refuses for new migrations",
    async () => {
      const { result, calls } = await runSmoke("forward");
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain(
        "Rollback to v50 is not offered: migration sets differ",
      );
      expect(result.stdout).toContain(
        "Telegram runtime transition from v50 passed",
      );
      expect(result.stdout).not.toContain("rollback to v50 passed");
      expect(
        calls.split("\n").filter((call) => call.endsWith("stop app")),
      ).toHaveLength(1);
      expect(calls).toContain("image rm");
    },
    runtimeProofBudgetMs,
  );

  it.each([
    ["manifest", "Previous release manifest is not a Telegram release"],
    ["history", "Previous migration identity mismatch"],
    ["image", "Candidate image source SHA mismatch"],
    ["ledger", "Candidate migration ledger changed"],
    ["sentinel", "Candidate sentinel changed"],
  ])(
    "rejects altered %s observations with a fatal diagnostic",
    async (scenario, diagnostic) => {
      const { result, calls } = await runSmoke(scenario);
      expect(result.status, result.stderr).toBe(1);
      expect(result.stderr).toContain(diagnostic);
      expect(result.stdout).not.toContain("passed");
      // Nothing is built for a refused release; a built candidate is always removed.
      expect(calls.includes("build ")).toBe(calls.includes("image rm"));
    },
  );
});
