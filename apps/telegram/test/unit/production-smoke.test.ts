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

// External tools are the seam: execute the entire public smoke script, including its cleanup.
// The real Docker runtime proof remains separate; these adapters make corrupt observations deterministic.
const dockerAdapter = String.raw`
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
const fixture = process.env.FIXTURES;
const stateFile = path.join(fixture, "state.json");
const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, "utf8")) : {};
fs.appendFileSync(path.join(fixture, "docker.log"), args.join(" ") + "\n");
const candidate = image => image === state.candidate;
if (args[0] === "build") {
  state.candidate = args[args.indexOf("--tag") + 1];
  fs.writeFileSync(stateFile, JSON.stringify(state));
} else if (args[0] === "image" && args[1] === "inspect") {
  const revision = candidate(args[2]) ? process.env.SOURCE_SHA : process.env.LEGACY_SHA;
  const result = args.includes("--format") && args.at(-1).includes("revision")
    ? (process.env.SCENARIO === "image" && candidate(args[2]) ? "0".repeat(40) : revision)
    : (candidate(args[2]) ? "candidate-image-id" : "legacy-image-id");
  console.log(result);
} else if (args[0] === "inspect") {
  console.log(candidate(state.active) ? "candidate-image-id" : "legacy-image-id");
} else if (args[0] === "compose") {
  if (args.includes("up")) {
    state.active = process.env.TELEGRAM_IMAGE;
    fs.writeFileSync(stateFile, JSON.stringify(state));
  } else if (args.includes("port")) console.log("127.0.0.1:45678");
  else if (args.includes("ps")) console.log("fixture-app");
} else if (args[0] === "exec" && args.includes("psql")) {
  const query = args.at(-1);
  if (query === "select count(*) from kysely_migration") console.log("31");
  else if (query === "select name from kysely_migration order by name") {
    const ledger = Array.from({length:31}, (_,i) => "migration-" + (i+1)).join("\n");
    console.log(ledger + (process.env.SCENARIO === "ledger" && candidate(state.active) ? "\nunexpected-migration" : ""));
  } else if (query === "select value from delivery_smoke_sentinel") {
    console.log(process.env.SCENARIO === "sentinel" && candidate(state.active) ? "corrupted" : "preserved");
  } else if (!query.startsWith("create table delivery_smoke_sentinel")) process.exit(1);
} else if (!["pull", "network", "run", "exec", "container", "image"].includes(args[0])) process.exit(1);
`;

const ghAdapter = String.raw`
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
if (args.slice(0,3).join(" ") !== "release download v5") process.exit(1);
fs.writeFileSync(path.join(args[args.indexOf("--dir")+1], "release-manifest.json"), JSON.stringify({
  schemaVersion: "inside.telegram.release-manifest.v1",
  version: "v5",
  source: {repository: "sachkov-inside/inside-telegram", sha: process.env.LEGACY_SHA},
  migrations: {identity: "sha256:f91e56479cfcae72f9596dc508c776c5c06e156f16d747e4e91d956931ca533d", count:31},
  image: "ghcr.io/sachkov-inside/inside-telegram@sha256:1159e5f27ed6f12528ae383f1f379bfdc41780a1b37dafb72d9b35ff34d1b748"
}));
`;

const curlAdapter = String.raw`
const fs = require("node:fs");
const args = process.argv.slice(2);
const outputIndex = args.findIndex(arg => arg === "--output" || arg === "-o");
const auth = args.includes("--request");
const body = JSON.stringify(auth ? {statusCode:401, message:"Unauthorized"} : {status:"ready"});
if (outputIndex < 0) process.stdout.write(body);
else fs.writeFileSync(args[outputIndex+1], body);
if (auth) process.stdout.write("401");
`;

const gitAdapter = String.raw`
if (process.argv.slice(2).join(" ") !== "rev-parse HEAD") process.exit(1);
console.log(process.env.SOURCE_SHA);
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
      writeFileSync(executable, `#!${process.execPath}\n${body}`);
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
      timeout: 30_000,
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
  it("accepts the complete transition and rollback, with no rollback migration", () => {
    const { result, calls } = runSmoke("valid");
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(
      "Telegram runtime transition and rollback passed",
    );
    expect(
      calls.split("\n").filter((call) => call.endsWith("migrate")),
    ).toHaveLength(2);
    expect(calls.slice(calls.lastIndexOf("stop app"))).not.toContain("migrate");
    expect(calls).toContain("container rm --force --volumes");
  });

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
