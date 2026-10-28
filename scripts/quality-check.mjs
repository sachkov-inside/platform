// @ts-check
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";
import { runPinnedTool, withPinnedTool } from "./quality-tools.mjs";

/** @param {string[]} patterns */
function trackedFiles(patterns = []) {
  return execFileSync(
    "git",
    [
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "-z",
      "--",
      ...patterns,
    ],
    {
      encoding: "utf8",
    },
  )
    .split("\0")
    .filter(Boolean);
}

async function secrets() {
  const snapshot = mkdtempSync(join(tmpdir(), "inside-quality-source-"));
  try {
    // Tracked and non-ignored new regular files enter the scan. Local credentials, dependencies, reports and
    // symlink targets outside this repository never enter the temporary snapshot.
    for (const file of trackedFiles()) {
      // Deliberately invalid tar fixture for release-admission rejection, not a source archive.
      if (file === "scripts/fixtures/release/production-runtime.tar.gz")
        continue;
      let stat;
      try {
        stat = lstatSync(file);
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        )
          continue;
        throw error;
      }
      if (!stat.isFile()) continue;
      const target = join(snapshot, file);
      mkdirSync(dirname(target), { recursive: true });
      try {
        linkSync(file, target);
      } catch {
        copyFileSync(file, target);
      }
    }
    const args = [
      "--no-banner",
      "--redact=100",
      "--confidence=medium",
      `--config=${join(process.cwd(), ".betterleaks.toml")}`,
      "--ignore-gitleaks-allow",
      "--timeout=180",
      "--exit-code=1",
    ];
    const report = join(snapshot, "quality-findings.json");
    /** @param {string[]} source */
    const scan = (source) =>
      withPinnedTool("betterleaks", (executable) => {
        const execution = spawnSync(
          executable,
          [
            ...source,
            ...args,
            "--report-format=json",
            `--report-path=${report}`,
          ],
          { encoding: "utf8", timeout: 200_000 },
        );
        if (execution.error !== undefined) throw execution.error;
        if (
          ![0, 1].includes(execution.status ?? -1) ||
          /\b(?:ERR|FTL)\b|WRN error|error reading/u.test(
            `${execution.stdout}${execution.stderr}`,
          )
        )
          throw new Error(
            "Secret scanner did not complete; inspect the pinned scanner locally with redaction enabled",
          );
        const findings = z
          .array(
            z.object({
              RuleID: z.string(),
              File: z.string(),
              StartLine: z.number(),
            }),
          )
          .parse(JSON.parse(readFileSync(report, "utf8")));
        for (const finding of findings)
          console.error(
            `${finding.File.replace(`${snapshot}/`, "")}:${String(finding.StartLine)} ${finding.RuleID}`,
          );
        if ((execution.status === 0) !== (findings.length === 0))
          throw new Error(
            "Secret scanner exit status disagrees with its report",
          );
        return execution.status;
      });
    const result = await scan(["dir", snapshot]);
    if (result !== 0) return result;
    const base = process.env["QUALITY_BASE_SHA"];
    if (base !== undefined && base !== "") {
      if (!/^[a-f0-9]{40}$/u.test(base))
        throw new Error("QUALITY_BASE_SHA must be a full commit SHA");
      return scan(["git", `--log-opts=${base}..HEAD`, "."]);
    }
    console.log("Tracked-source secret scan passed (medium/high confidence).");
    return 0;
  } finally {
    rmSync(snapshot, { recursive: true, force: true });
  }
}

async function shell() {
  const files = trackedFiles(["*.sh", ".githooks/*"]).filter(
    (file) => !file.startsWith(".agents/") && !file.includes("/fixtures/"),
  );
  return runPinnedTool("shellcheck", ["--severity=style", ...files]);
}

async function docker() {
  const files = trackedFiles(["*Dockerfile*"]).filter(
    (file) => !file.includes("/fixtures/"),
  );
  for (const file of files) {
    // The digest-pinned Logto fork inherits upstream WORKDIR and build instructions.
    // Its provenance/build contracts remain authoritative for these upstream conventions.
    const ignored =
      file === "infra/identity/logto/Dockerfile"
        ? ["DL3045", "DL3003", "DL3018"]
        : file === "infra/notifications/Dockerfile"
          ? ["DL3018"]
          : file === "tools/practice-review/native/chapter-one/Dockerfile"
            ? ["DL3008"]
            : [];
    const result = await runPinnedTool("hadolint", [
      "--failure-threshold=warning",
      ...ignored.flatMap((rule) => ["--ignore", rule]),
      file,
    ]);
    if (result !== 0) return result;
  }
  return 0;
}

function agents() {
  const config = z
    .object({
      mcpServers: z.object({
        "platform-storybook": z.object({
          type: z.literal("http"),
          url: z.url(),
        }),
      }),
    })
    .parse(JSON.parse(readFileSync(".mcp.json", "utf8")));
  const codex = readFileSync(".codex/config.toml", "utf8");
  const section = codex.match(
    /^\[mcp_servers\.platform-storybook\]\s*\n([\s\S]*?)(?=^\[|(?![\s\S]))/mu,
  )?.[1];
  const url = section?.match(/^url\s*=\s*"([^"\n]+)"\s*$/mu)?.[1];
  if (url !== config.mcpServers["platform-storybook"].url)
    throw new Error(
      "Storybook MCP URLs disagree between .mcp.json and .codex/config.toml",
    );
  console.log("Agent MCP configuration is consistent.");
  return 0;
}

async function main() {
  const mode = process.argv[2];
  if (mode === "secrets") return secrets();
  if (mode === "shell") return shell();
  if (mode === "docker") return docker();
  if (mode === "agents") return agents();
  if (mode === "workflows")
    return withPinnedTool("shellcheck", (executable) =>
      runPinnedTool("jactionlint", [
        "--no-online",
        "--strict-exit",
        "--shellcheck",
        executable,
        "--pyflakes=",
      ]),
    );
  if (mode === "audit") {
    const result = spawnSync(
      "pnpm",
      ["audit", "--prod", "--audit-level=moderate"],
      { stdio: "inherit", timeout: 120_000 },
    );
    if (result.error !== undefined) throw result.error;
    return result.status ?? 1;
  }
  throw new Error(
    "Expected quality mode: secrets, audit, workflows, shell, docker or agents",
  );
}

process.exitCode = await main();
