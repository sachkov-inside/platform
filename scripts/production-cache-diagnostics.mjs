// @ts-check
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";
import { spawnOwned, stopOwned } from "./owned-process.mjs";
import { commandExit } from "./diagnostic-command.mjs";

const observationBudgetMilliseconds = 1500;
const cleanupBudgetMilliseconds = 30000;
const outputLimit = 65536;
/** Drop sensitive lines before persistence, including truncated secrets and URL credentials/queries.
 * @param {string} value
 */
function redact(value) {
  return stripVTControlCharacters(value)
    .split(/\r?\n/u)
    .map((line) =>
      line.includes("://") ||
      line.toLowerCase().includes("eyj") ||
      /(?:token|secret|password|passwd|credential|authorization|bearer|gh[pousr]_|AKIA)/iu.test(
        line,
      )
        ? "[REDACTED]"
        : line.replace(/[A-Za-z0-9_+/-]{32,}/gu, "[REDACTED]"),
    )
    .join("\n");
}
/** Fixed diagnostic/cleanup boundary. No arbitrary executable or arguments come from the CLI.
 * @param {string} command @param {string[]} args
 * @param {number} [budgetMilliseconds]
 */
async function capture(
  command,
  args,
  budgetMilliseconds = observationBudgetMilliseconds,
) {
  let output = "";
  let truncated = false;
  let timedOut = false;
  const child = spawnOwned(command, args);
  const collect = (/** @type {Buffer} */ chunk) => {
    const remaining = outputLimit - output.length;
    output += chunk.toString().slice(0, Math.max(0, remaining));
    truncated ||= chunk.length > remaining;
  };
  child.stdout?.on("data", collect);
  child.stderr?.on("data", collect);
  child.stdin?.end();
  const timer = setTimeout(() => {
    timedOut = true;
    void stopOwned(child, 100);
  }, budgetMilliseconds);
  try {
    const status = await commandExit(child);
    return { status, timedOut, truncated, output: redact(output) };
  } catch {
    return { status: null, timedOut, truncated, output: "Capture unavailable" };
  } finally {
    clearTimeout(timer);
    await stopOwned(child, 100);
  }
}

async function main() {
  const [mode, directory, owner, source, phase, rawStatus] =
    process.argv.slice(2);
  if (
    !directory ||
    !owner ||
    !/^inside-platform-production-smoke-cache-ci-\d+$/u.test(owner) ||
    !source ||
    !/^[0-9a-f]{40}$/u.test(source) ||
    !phase ||
    !/^[a-z0-9-]+$/u.test(phase) ||
    !["before", "after"].includes(mode ?? "")
  )
    throw new Error("Invalid diagnostic scope");
  const status = rawStatus === undefined ? null : Number(rawStatus);
  if (
    status !== null &&
    (!Number.isInteger(status) || status < 0 || status > 255)
  )
    throw new Error("Invalid status");
  try {
    mkdirSync(directory, { recursive: true });
  } catch {
    /* Cleanup still runs if artifacts cannot be written. */
  }
  const metadata = {
    run: /^\d+$/u.test(process.env["GITHUB_RUN_ID"] ?? "")
      ? process.env["GITHUB_RUN_ID"]
      : null,
    attempt: /^\d+$/u.test(process.env["GITHUB_RUN_ATTEMPT"] ?? "")
      ? process.env["GITHUB_RUN_ATTEMPT"]
      : null,
    capturedAt: new Date().toISOString(),
    source,
    phase,
    status,
  };
  // Persist metadata before any command, even if a diagnostic command hangs or fails.
  const filename = resolve(directory, `preparation-${mode}.json`);
  try {
    writeFileSync(filename, JSON.stringify(metadata, null, 2));
  } catch {
    /* Best effort. */
  }
  /** @type {Array<[string, string[]]>} */
  const commands = [
    [
      "docker",
      [
        "version",
        "--format",
        "Client={{.Client.Version}} Server={{.Server.Version}}",
      ],
    ],
    [
      "docker",
      [
        "info",
        "--format",
        "Server={{.ServerVersion}} Driver={{.Driver}} CPUs={{.NCPU}} Memory={{.MemTotal}}",
      ],
    ],
    ["docker", ["buildx", "version"]],
    [
      "systemctl",
      [
        "show",
        "docker.service",
        "containerd.service",
        "--property=Id,MainPID,NRestarts,ActiveState,SubState,ExecMainStatus",
      ],
    ],
    ["free", ["-b"]],
    ["df", ["-Pk", "."]],
    ["df", ["-Pi", "."]],
    [
      process.execPath,
      [
        fileURLToPath(
          new URL("./cgroup-memory-diagnostics.mjs", import.meta.url),
        ),
      ],
    ],
    [
      "sudo",
      [
        "-n",
        "journalctl",
        "--no-pager",
        "--since=-10 minutes",
        "--lines=200",
        "--output=short-iso",
        "--unit=docker.service",
        "--unit=containerd.service",
      ],
    ],
    [
      "sudo",
      [
        "-n",
        "journalctl",
        "-k",
        "--no-pager",
        "--since=-10 minutes",
        "--lines=200",
        "--grep=Out of memory|oom|Killed process|Memory cgroup",
      ],
    ],
  ];
  /** @type {Record<string, Awaited<ReturnType<typeof capture>>>} */
  const results = {};
  for (const [index, entry] of commands.entries()) {
    const [command, args] = entry;
    const names = [
      "docker-version",
      "docker-info",
      "buildx-version",
      "services",
      "memory",
      "disk",
      "inodes",
      "cgroup",
      "daemon-journal",
      "kernel-oom",
    ];
    results[names[index] ?? `capture-${index}`] = await capture(command, args);
  }
  if (mode === "after")
    results["cleanup"] = await capture(
      "docker",
      [
        "image",
        "rm",
        `${owner}-backend:v1`,
        `${owner}-backend:v2`,
        `${owner}-web:v1`,
        `${owner}-foundation:local`,
      ],
      cleanupBudgetMilliseconds,
    );
  try {
    writeFileSync(
      filename,
      JSON.stringify({ ...metadata, captures: results }, null, 2),
    );
  } catch {
    /* Original status belongs to the caller. */
  }
  if (mode === "after" && results["cleanup"]?.status !== 0)
    process.exitCode = 1;
}
main().catch(() => {
  console.error("Preparation diagnostic capture unavailable");
  process.exitCode = 1;
});
