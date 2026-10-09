// @ts-check
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const callsSchema = z.array(
  z.object({
    command: z.string(),
    args: z.array(z.string()),
    source: z.string().optional(),
  }),
);

/** @param {{ freeGiB?: number; productionWeb?: boolean; failedBuild?: string; exhaustDisk?: boolean; dirtySource?: boolean; runningStand?: boolean }} [options] */
function launch({
  freeGiB = 50,
  productionWeb = false,
  failedBuild = "",
  exhaustDisk = false,
  dirtySource = false,
  runningStand = false,
} = {}) {
  const root = mkdtempSync(join(tmpdir(), "platform-stand-cli-"));
  try {
    cpSync(join(repositoryRoot, "scripts"), join(root, "scripts"), {
      recursive: true,
    });
    symlinkSync(
      join(repositoryRoot, "node_modules"),
      join(root, "node_modules"),
      "dir",
    );
    mkdirSync(join(root, "bin"));
    mkdirSync(join(root, "tmp"));
    const log = join(root, "calls.jsonl");
    const capacityFile = join(root, "capacity.txt");
    writeFileSync(capacityFile, String(freeGiB));
    writeFileSync(log, "");
    const adapter = `#!/usr/bin/env node
import { appendFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.CALL_LOG, JSON.stringify({command: process.argv[1].endsWith("docker") ? "docker" : "pnpm", args, source: process.env.STAND_WEB_SOURCE_SHA}) + "\\n");
if(args.includes("build") && args.includes(process.env.FAILED_BUILD)) process.exit(9);
if(args.includes("ps") && process.env.RUNNING_STAND === "true") process.stdout.write("api\\n");
if(args.includes("build") && process.env.EXHAUST_DISK === "true") { writeFileSync(process.env.CAPACITY_FILE, "14"); setInterval(() => {}, 1000); }
`;
    writeFileSync(join(root, "bin/docker"), adapter, { mode: 0o755 });
    writeFileSync(join(root, "bin/pnpm.mjs"), adapter);
    // Filesystem capacity and the temporary-directory root are external system boundaries.
    writeFileSync(
      join(root, "capacity.mjs"),
      `import fs from "node:fs"; import os from "node:os"; import {syncBuiltinESMExports} from "node:module";
fs.statfsSync = () => ({bavail: Number(fs.readFileSync(${JSON.stringify(capacityFile)}, "utf8")) * 1024 ** 3, bsize: 1});
os.tmpdir = () => ${JSON.stringify(join(root, "tmp"))}; syncBuiltinESMExports();`,
    );
    execFileSync("git", ["init", "--quiet"], { cwd: root });
    writeFileSync(join(root, "source.txt"), "fixture source\n");
    execFileSync("git", ["add", "source.txt"], { cwd: root });
    execFileSync(
      "git",
      [
        "-c",
        "user.name=Stand Test",
        "-c",
        "user.email=stand@example.invalid",
        "commit",
        "--quiet",
        "-m",
        "fixture",
      ],
      { cwd: root },
    );
    writeFileSync(join(root, ".git/info/exclude"), "*\n");
    const sha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim();
    if (dirtySource)
      writeFileSync(join(root, "source.txt"), "modified source\n");
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        join(root, "capacity.mjs"),
        join(root, "scripts/local-stand.mjs"),
        ...(productionWeb ? ["--production-web"] : []),
      ],
      {
        cwd: root,
        encoding: "utf8",
        timeout: 30_000,
        env: {
          ...process.env,
          PATH: `${join(root, "bin")}:${process.env["PATH"] ?? ""}`,
          npm_execpath: join(root, "bin/pnpm.mjs"),
          CALL_LOG: log,
          FAILED_BUILD: failedBuild,
          CAPACITY_FILE: capacityFile,
          EXHAUST_DISK: String(exhaustDisk),
          RUNNING_STAND: String(runningStand),
          NODE_OPTIONS: "",
          COMPOSE_PROJECT_NAME: "unrelated-project",
        },
      },
    );
    const calls = callsSchema.parse(
      readFileSync(log, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => z.unknown().parse(JSON.parse(line))),
    );
    return { result, calls, sha };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("standard stand builds one backend payload, then starts roles without rebuilding", () => {
  const { result, calls } = launch();
  assert.equal(result.status, 0, result.stderr);
  const builds = calls.filter((call) => call.args.includes("build"));
  assert.deepEqual(
    builds.map((call) => call.args.at(-1)),
    ["api", "web", "rabbitmq", "logto"],
  );
  for (const call of calls.filter((call) => call.args.includes("up"))) {
    assert.ok(call.args.includes("--no-build"));
    assert.ok(!call.args.includes("--build"));
  }
});

test("insufficient measured disk space refuses before certificates, builds or startup", () => {
  const { result, calls } = launch({ freeGiB: 24 });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /25 GiB/u);
  assert.ok(
    !calls.some((call) =>
      call.args.some((arg) =>
        ["build", "up", "identity:proof:certs", "down"].includes(arg),
      ),
    ),
  );
});

test("production web uses the exact Git revision instead of a placeholder source SHA", () => {
  const { result, calls, sha } = launch({ productionWeb: true });
  assert.equal(result.status, 0, result.stderr);
  const web = calls.find(
    (call) => call.args.includes("build") && call.args.at(-1) === "web",
  );
  assert.ok(web);
  assert.equal(web.source, sha);
  assert.ok(
    web.args.includes("config/compose/local/production-web.compose.yaml"),
  );
});

test("a failed build cannot start or shut down a stand it never started", () => {
  const { result, calls } = launch({ failedBuild: "web" });
  assert.notEqual(result.status, 0);
  assert.ok(
    !calls.some(
      (call) => call.args.includes("up") || call.args.includes("down"),
    ),
  );
});

test("disk exhaustion interrupts an active build before startup", () => {
  const { result, calls } = launch({ exhaustDisk: true });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /15 GiB host reserve/u);
  assert.ok(
    !calls.some(
      (call) => call.args.includes("up") || call.args.includes("down"),
    ),
  );
});

test("production source edits cannot reuse a committed release identity", () => {
  const { result, calls } = launch({ productionWeb: true, dirtySource: true });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Commit source changes/u);
  assert.ok(
    !calls.some(
      (call) => call.args.includes("build") || call.args.includes("up"),
    ),
  );
});

test("another session's running stand is never built, restarted or stopped", () => {
  const { result, calls } = launch({ runningStand: true });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /belongs to another session/u);
  assert.ok(
    !calls.some(
      (call) =>
        call.args.includes("build") ||
        call.args.includes("up") ||
        call.args.includes("down"),
    ),
  );
});
