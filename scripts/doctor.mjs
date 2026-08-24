import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { connect } from "node:net";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const developmentPorts = [3000, 3001, 5432];

export function evaluateDoctor(facts, expected) {
  const checks = [];
  checks.push(
    facts.nodeVersion === expected.nodeVersion
      ? pass("Node.js", `v${facts.nodeVersion}`)
      : fail(
          "Node.js",
          `expected v${expected.nodeVersion}, received v${facts.nodeVersion}`,
          `Install and select Node ${expected.nodeVersion} from .node-version (for example: fnm use).`,
        ),
  );
  checks.push(
    facts.pnpmVersion === expected.pnpmVersion
      ? pass("pnpm", facts.pnpmVersion)
      : fail(
          "pnpm",
          `expected ${expected.pnpmVersion}, received ${facts.pnpmVersion ?? "unknown"}`,
          `Install the packageManager version from package.json: pnpm@${expected.pnpmVersion}.`,
        ),
  );
  checks.push(
    facts.environmentFileExists
      ? pass("Environment", ".env exists")
      : fail(
          "Environment",
          ".env is missing",
          "Run pnpm local:setup or copy .env.example to .env.",
        ),
  );
  checks.push(commandCheck("Docker CLI", facts.dockerCli, "Install Docker."));
  checks.push(
    commandCheck(
      "Docker Compose",
      facts.composePlugin,
      "Install Docker Compose v2.",
    ),
  );
  checks.push(
    commandCheck(
      "Docker daemon",
      facts.dockerDaemon,
      "Start Docker and wait until the daemon is ready.",
    ),
  );

  for (const port of developmentPorts) {
    const occupied = facts.occupiedPorts.includes(port);
    if (!occupied) {
      checks.push(pass(`Port ${String(port)}`, "available"));
      continue;
    }
    if (port === 5432 && facts.postgresComposeRunning) {
      checks.push(pass("Port 5432", "owned by the running Platform Compose PostgreSQL"));
      continue;
    }
    checks.push(
      fail(
        `Port ${String(port)}`,
        "already in use",
        `Stop the conflicting process before starting Platform on port ${String(port)}.`,
      ),
    );
  }

  return checks;
}

export async function collectDoctorFacts() {
  const [dockerCli, composePlugin, dockerDaemon, runningServices, occupiedPorts] =
    await Promise.all([
      command("docker", ["--version"]),
      command("docker", ["compose", "version"]),
      command("docker", ["info", "--format", "{{.ServerVersion}}"]),
      command("docker", ["compose", "ps", "--services", "--status", "running"]),
      occupiedDevelopmentPorts(),
    ]);
  const packageManager = process.env.npm_config_user_agent
    ?.split(" ")[0]
    ?.replace(/^pnpm\//u, "");

  return {
    nodeVersion: process.versions.node,
    pnpmVersion: packageManager,
    environmentFileExists: existsSync(resolve(repositoryRoot, ".env")),
    dockerCli,
    composePlugin,
    dockerDaemon,
    postgresComposeRunning:
      runningServices.ok && runningServices.output.split(/\s+/u).includes("postgres"),
    occupiedPorts,
  };
}

export function readExpectedVersions() {
  const packageJson = JSON.parse(
    readFileSync(resolve(repositoryRoot, "package.json"), "utf8"),
  );
  if (
    typeof packageJson.packageManager !== "string" ||
    !packageJson.packageManager.startsWith("pnpm@")
  ) {
    throw new Error("package.json must declare packageManager as pnpm@<version>");
  }

  return {
    nodeVersion: readFileSync(resolve(repositoryRoot, ".node-version"), "utf8").trim(),
    pnpmVersion: packageJson.packageManager.slice("pnpm@".length),
  };
}

async function main() {
  const checks = evaluateDoctor(await collectDoctorFacts(), readExpectedVersions());
  for (const check of checks) {
    const marker = check.ok ? "PASS" : "FAIL";
    process.stdout.write(`[${marker}] ${check.name}: ${check.message}\n`);
    if (!check.ok) {
      process.stdout.write(`       Fix: ${check.fix}\n`);
    }
  }
  if (checks.some((check) => !check.ok)) {
    process.exitCode = 1;
  }
}

function pass(name, message) {
  return { ok: true, name, message };
}

function fail(name, message, fix) {
  return { ok: false, name, message, fix };
}

function commandCheck(name, result, fix) {
  return result.ok ? pass(name, result.output) : fail(name, result.output, fix);
}

async function command(executable, arguments_) {
  try {
    const { stdout, stderr } = await execFileAsync(executable, arguments_, {
      cwd: repositoryRoot,
      timeout: 5_000,
    });
    return { ok: true, output: stdout.trim() || stderr.trim() || "available" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, output: message.split("\n")[0] };
  }
}

async function occupiedDevelopmentPorts() {
  const states = await Promise.all(
    developmentPorts.map(async (port) => ({
      port,
      occupied: await isPortOccupied(port),
    })),
  );
  return states.filter(({ occupied }) => occupied).map(({ port }) => port);
}

function isPortOccupied(port) {
  return new Promise((resolveOccupied) => {
    const socket = connect({ host: "127.0.0.1", port });
    socket.setTimeout(300);
    socket.once("connect", () => {
      socket.destroy();
      resolveOccupied(true);
    });
    socket.once("error", () => resolveOccupied(false));
    socket.once("timeout", () => {
      socket.destroy();
      resolveOccupied(false);
    });
  });
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
