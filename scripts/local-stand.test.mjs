// @ts-check
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
import { spawnOwned, stopOwned } from "./owned-process.mjs";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const callsSchema = z.array(
  z.object({
    command: z.string(),
    args: z.array(z.string()),
    source: z.string().optional(),
    storageOrigin: z.string().optional(),
  }),
);

/** @param {string} root @param {string[]} args */
async function fixtureGit(root, args) {
  const child = spawnOwned(
    "git",
    ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args],
    { cwd: root, timeout: 5_000 },
  );
  try {
    let output = "";
    let diagnostic = "";
    child.stdout?.on("data", (/** @type {Buffer} */ chunk) => {
      output += chunk.toString();
    });
    child.stderr?.on("data", (/** @type {Buffer} */ chunk) => {
      diagnostic += chunk.toString();
    });
    /** @type {Promise<number | null>} */
    const outcome = new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", resolve);
    });
    const status = await outcome;
    assert.equal(status, 0, diagnostic);
    return output.trim();
  } finally {
    await stopOwned(child);
  }
}

/** @param {{ freeGiB?: number; productionWeb?: boolean; storagePort?: string; envFileStoragePort?: string; composeStorageEndpoint?: string; failedBuild?: string; failedStartup?: boolean; exhaustDisk?: boolean; dirtySource?: boolean; runningStand?: boolean; diagnosticLog?: boolean }} [options] */
async function launch({
  freeGiB = 50,
  productionWeb = false,
  storagePort,
  envFileStoragePort,
  composeStorageEndpoint = `http://127.0.0.1:${storagePort === undefined || storagePort === "" ? "9000" : storagePort}`,
  failedBuild = "",
  failedStartup = false,
  exhaustDisk = false,
  dirtySource = false,
  runningStand = false,
  diagnosticLog = false,
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
    const dockerStorage = join(root, "docker-storage");
    mkdirSync(dockerStorage);
    writeFileSync(
      join(dockerStorage, "Docker.raw"),
      "synthetic disk metadata fixture",
    );
    writeFileSync(capacityFile, String(freeGiB));
    writeFileSync(log, "");
    const adapter = `#!/usr/bin/env node
import { appendFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.CALL_LOG, JSON.stringify({command: process.argv[1].endsWith("docker") ? "docker" : "pnpm", args, source: process.env.STAND_WEB_SOURCE_SHA, storageOrigin: process.env.STAND_WEB_OBJECT_STORAGE_ORIGIN}) + "\\n");
if(args.includes("build") && args.includes(process.env.FAILED_BUILD)) process.exit(9);
if(args.includes("up") && !args.includes("logto-postgres") && process.env.FAILED_STARTUP === "true") process.exit(1);
if(args.includes("logs")) process.stdout.write("migrations: primary dependency error\\n");
if(process.argv[1].endsWith("lsof")) process.stdout.write("n" + process.env.DOCKER_STORAGE + "/Docker.raw\\n");
if(args.includes("info")) process.stdout.write(process.env.DOCKER_STORAGE + "\\n");
if(args.includes("config")) { process.stderr.write("fixture config warning\\n"); process.stdout.write(JSON.stringify({services: {api: {environment: {OBJECT_STORAGE_SIGNED_GET_ENDPOINT: process.env.COMPOSE_STORAGE_ENDPOINT}}}})); }
if(args.includes("ps") && process.env.RUNNING_STAND === "true") process.stdout.write("api\\n");
if(args.includes("build") && process.env.EXHAUST_DISK === "true") { writeFileSync(process.env.CAPACITY_FILE, "9"); setInterval(() => {}, 1000); }
`;
    writeFileSync(join(root, "bin/docker"), adapter, { mode: 0o755 });
    writeFileSync(join(root, "bin/lsof"), adapter, { mode: 0o755 });
    writeFileSync(join(root, "bin/pnpm.mjs"), adapter);
    // Filesystem capacity and the temporary-directory root are external system boundaries.
    writeFileSync(
      join(root, "capacity.mjs"),
      `import fs from "node:fs"; import os from "node:os"; import {syncBuiltinESMExports} from "node:module";
fs.statfsSync = (path) => {if(path !== ${JSON.stringify(dockerStorage)} && path !== ${JSON.stringify(join(dockerStorage, "Docker.raw"))}) throw new Error("Budget measured the repository instead of Docker storage"); return {bavail: Number(fs.readFileSync(${JSON.stringify(capacityFile)}, "utf8")) * 1024 ** 3, bsize: 1};};
os.tmpdir = () => ${JSON.stringify(join(root, "tmp"))}; syncBuiltinESMExports();`,
    );
    await fixtureGit(root, ["init", "--quiet"]);
    writeFileSync(join(root, "source.txt"), "fixture source\n");
    await fixtureGit(root, ["add", "source.txt"]);
    await fixtureGit(root, [
      "-c",
      "user.name=Stand Test",
      "-c",
      "user.email=stand@example.invalid",
      "commit",
      "--quiet",
      "-m",
      "fixture",
    ]);
    cpSync(join(repositoryRoot, ".gitignore"), join(root, ".gitignore"));
    if (envFileStoragePort !== undefined)
      writeFileSync(
        join(root, ".env"),
        `OBJECT_STORAGE_HOST_PORT=${envFileStoragePort}\n`,
      );
    writeFileSync(
      join(root, ".git/info/exclude"),
      "scripts/\nnode_modules\nbin/\ntmp/\ndocker-storage/\n.gitignore\ncalls.jsonl\ncapacity.txt\ncapacity.mjs\n",
    );
    const sha = await fixtureGit(root, ["rev-parse", "HEAD"]);
    if (dirtySource)
      writeFileSync(join(root, "source.txt"), "modified source\n");
    if (diagnosticLog)
      writeFileSync(join(root, "diagnostic.log"), "local diagnostic\n");
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
          FAILED_STARTUP: String(failedStartup),
          CAPACITY_FILE: capacityFile,
          DOCKER_STORAGE: dockerStorage,
          EXHAUST_DISK: String(exhaustDisk),
          RUNNING_STAND: String(runningStand),
          NODE_OPTIONS: "",
          COMPOSE_PROJECT_NAME: "unrelated-project",
          OBJECT_STORAGE_HOST_PORT: storagePort,
          COMPOSE_STORAGE_ENDPOINT: composeStorageEndpoint,
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

test("production stand uses the Compose-resolved storage endpoint from .env (CLI adapter)", async () => {
  const { result, calls } = await launch({
    productionWeb: true,
    envFileStoragePort: "9157",
    composeStorageEndpoint: "http://127.0.0.1:9157",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /fixture config warning/u);
  const configIndex = calls.findIndex((call) => call.args.includes("config"));
  const buildIndex = calls.findIndex((call) => call.args.includes("build"));
  assert.ok(configIndex >= 0 && configIndex < buildIndex);
  const config = calls[configIndex];
  assert.ok(config);
  assert.ok(config.args.includes("--no-env-resolution"));
  assert.ok(
    config.args.includes("config/compose/local/learner-setup.compose.yaml"),
  );
  assert.ok(
    !config.args.includes("config/compose/local/production-web.compose.yaml"),
  );
  const web = calls.find(
    (call) => call.args.includes("build") && call.args.at(-1) === "web",
  );
  assert.ok(web);
  assert.equal(web.storageOrigin, "http://127.0.0.1:9157");
});

test("development stand builds one workspace for backend roles and Web", async () => {
  const { result, calls } = await launch();
  assert.equal(result.status, 0, result.stderr);
  const builds = calls.filter((call) => call.args.includes("build"));
  assert.deepEqual(
    builds.map((call) => call.args.at(-1)),
    ["api", "rabbitmq", "logto"],
  );
  for (const call of calls.filter((call) => call.args.includes("up"))) {
    assert.ok(call.args.includes("--no-build"));
    assert.ok(!call.args.includes("--build"));
  }
});

test("insufficient measured disk space refuses before certificates, builds or startup", async () => {
  const { result, calls } = await launch({ freeGiB: 19 });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /20 GiB/u);
  assert.ok(
    !calls.some((call) =>
      call.args.some((arg) =>
        ["build", "up", "identity:proof:certs", "down"].includes(arg),
      ),
    ),
  );
});

test("production web uses the exact Git revision instead of a placeholder source SHA", async () => {
  const { result, calls, sha } = await launch({ productionWeb: true });
  assert.equal(result.status, 0, result.stderr);
  const web = calls.find(
    (call) => call.args.includes("build") && call.args.at(-1) === "web",
  );
  assert.ok(web);
  assert.equal(web.source, sha);
  assert.equal(web.storageOrigin, "http://127.0.0.1:9000");
  assert.ok(
    web.args.includes("config/compose/local/production-web.compose.yaml"),
  );
  assert.deepEqual(
    calls
      .filter((call) => call.args.includes("build"))
      .map((call) => call.args.at(-1)),
    ["api", "web", "rabbitmq", "logto"],
  );
});

for (const [name, port, origin] of /** @type {const} */ ([
  ["default HTTP port", "80", "http://127.0.0.1"],
  ["configured HTTP port", "9157", "http://127.0.0.1:9157"],
  ["empty port override", "", "http://127.0.0.1:9000"],
])) {
  test(`production stand passes a canonical storage origin for ${name} (CLI adapter)`, async () => {
    const { result, calls } = await launch({
      productionWeb: true,
      storagePort: port,
    });
    assert.equal(result.status, 0, result.stderr);
    const web = calls.find(
      (call) => call.args.includes("build") && call.args.at(-1) === "web",
    );
    assert.ok(web);
    assert.equal(web.storageOrigin, origin);
  });
}

test("a failed build cannot start or shut down a stand it never started", async () => {
  const { result, calls } = await launch({ failedBuild: "api" });
  assert.notEqual(result.status, 0);
  assert.ok(
    !calls.some(
      (call) => call.args.includes("up") || call.args.includes("down"),
    ),
  );
});

test("failed startup prints primary job diagnostics before shutting down without volumes", async () => {
  const { result, calls } = await launch({ failedStartup: true });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /migrations: primary dependency error/u);
  const logs = calls.findIndex((call) => call.args.includes("logs"));
  const down = calls.findIndex((call) => call.args.includes("down"));
  assert.ok(logs >= 0 && down > logs);
  assert.ok(calls[logs]?.args.includes("migrations"));
  assert.ok(!calls[down]?.args.includes("--volumes"));
});

test("disk exhaustion interrupts an active build before startup", async () => {
  const { result, calls } = await launch({ exhaustDisk: true });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /10 GiB host floor/u);
  assert.ok(
    !calls.some(
      (call) => call.args.includes("up") || call.args.includes("down"),
    ),
  );
});

test("production source edits cannot reuse a committed release identity", async () => {
  const { result, calls } = await launch({
    productionWeb: true,
    dirtySource: true,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Commit source changes/u);
  assert.ok(
    !calls.some(
      (call) => call.args.includes("build") || call.args.includes("up"),
    ),
  );
});

test("another session's running stand is never built, restarted or stopped", async () => {
  const { result, calls } = await launch({ runningStand: true });
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

test("production stand accepts an untracked diagnostic log outside its Docker context", async () => {
  const { result } = await launch({ productionWeb: true, diagnosticLog: true });
  assert.equal(result.status, 0, result.stderr);
});
