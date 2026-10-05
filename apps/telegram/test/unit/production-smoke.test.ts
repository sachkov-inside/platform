import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = path.resolve("../..");
const smoke = path.join(root, "apps/telegram/scripts/production-smoke.sh");
const legacySha = "10dfbee3c9dd39d2dacdc39f8c7926ecd4498820";
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
        else printf '%s\n' "$LEGACY_SHA"; fi
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
      esac
    done ;;
  exec)
    if [[ "$3" == psql ]]; then
      read -r candidate <"$FIXTURES/candidate"
      read -r active <"$FIXTURES/active"
      for query in "$@"; do :; done
      case "$query" in
        'select count(*) from kysely_migration') echo 31 ;;
        'select name from kysely_migration order by name')
          for ((i=1; i<=31; i+=1)); do printf 'migration-%s\n' "$i"; done
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
[[ "$1 $2 $3" == 'release download v5' ]] || exit 1
while [[ "$#" -gt 0 ]]; do
  if [[ "$1" == --dir ]]; then destination="$2"; break; fi
  shift
done
cat >"$destination/release-manifest.json" <<JSON
{"schemaVersion":"inside.telegram.release-manifest.v1","version":"v5","source":{"repository":"sachkov-inside/inside-telegram","sha":"$LEGACY_SHA"},"migrations":{"identity":"sha256:f91e56479cfcae72f9596dc508c776c5c06e156f16d747e4e91d956931ca533d","count":31},"image":"ghcr.io/sachkov-inside/inside-telegram@sha256:1159e5f27ed6f12528ae383f1f379bfdc41780a1b37dafb72d9b35ff34d1b748"}
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

function runSmoke(scenario: string) {
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
    const result = spawnSync("/bin/bash", [smoke], {
      cwd: fixture,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}:${process.env["PATH"] ?? ""}`,
        TMPDIR: fixture,
        FIXTURES: fixture,
        SCENARIO: scenario,
        SOURCE_SHA: sourceSha,
        LEGACY_SHA: legacySha,
      },
      timeout: runtimeProofBudgetMs,
    });
    return {
      result,
      calls: readFileSync(path.join(fixture, "docker.log"), "utf8"),
    };
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}

describe("Telegram production runtime smoke", () => {
  it(
    "accepts the complete transition and rollback, with no rollback migration",
    () => {
      const { result, calls } = runSmoke("valid");
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain(
        "Telegram runtime transition and rollback passed",
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

  it.each([
    ["image", "Candidate image source SHA mismatch"],
    ["ledger", "Candidate migration ledger changed"],
    ["sentinel", "Candidate sentinel changed"],
  ])(
    "rejects altered %s observations with a fatal diagnostic",
    (scenario, diagnostic) => {
      const { result, calls } = runSmoke(scenario);
      expect(result.status, result.stderr).toBe(1);
      expect(result.stderr).toContain(diagnostic);
      expect(result.stdout).not.toContain(
        "Telegram runtime transition and rollback passed",
      );
      expect(calls).toContain("image rm");
    },
  );
});
