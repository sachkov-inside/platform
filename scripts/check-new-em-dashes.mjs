// @ts-check
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * New human-facing copy uses periods, commas or parentheses instead of the em dash (owner rule in
 * root AGENTS.md). Only lines added since the comparison base are checked, so existing text stays
 * until someone edits it. Comment-only lines in code are developer notes, not copy.
 */

const scriptPath = fileURLToPath(import.meta.url);
const defaultRepositoryRoot = resolve(dirname(scriptPath), "..");

export const emDashScopes = ["apps/web", "docs"];
const emDash = "—";
const codeFile = /\.(?:[cm]?[jt]sx?|css)$/u;
const commentLine = /^\s*(?:\/\/|\/\*|\*|\{\s*\/\*)/u;

/**
 * Added lines containing an em dash in a zero-context unified diff.
 *
 * @param {string} diff output of `git diff -U0`
 * @returns {{ file: string; line: number; text: string }[]}
 */
export function findAddedEmDashes(diff) {
  /** @type {{ file: string; line: number; text: string }[]} */
  const findings = [];
  let file = "";
  let line = 0;
  for (const row of diff.split("\n")) {
    if (row.startsWith("+++ ")) {
      file =
        row === "+++ /dev/null" ? "" : row.replace(/^\+\+\+ (?:b\/)?/u, "");
      continue;
    }
    const hunk = row.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/u);
    if (hunk) {
      line = Number(hunk[1]);
      continue;
    }
    if (row.startsWith("+") && file !== "") {
      const text = row.slice(1);
      if (
        text.includes(emDash) &&
        !(codeFile.test(file) && commentLine.test(text))
      ) {
        findings.push({ file, line, text: text.trim() });
      }
      line += 1;
    }
  }
  return findings;
}

/**
 * @param {string} repositoryRoot
 * @param {string[]} args
 */
function git(repositoryRoot, args) {
  return spawnSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
}

/**
 * Compares the working tree (or the index with `staged`) with the merge base of HEAD and
 * `origin/main`, or with an explicit base revision.
 *
 * @param {{ repositoryRoot?: string; base?: string | undefined; staged?: boolean }} options
 * @returns {{ base: string | undefined; findings: ReturnType<typeof findAddedEmDashes> }}
 */
export function checkNewEmDashes({
  repositoryRoot = defaultRepositoryRoot,
  base,
  staged = false,
} = {}) {
  let comparison = base;
  if (!staged && comparison === undefined) {
    const mergeBase = git(repositoryRoot, [
      "merge-base",
      "HEAD",
      "origin/main",
    ]);
    if (mergeBase.status !== 0) {
      return { base: undefined, findings: [] };
    }
    comparison = mergeBase.stdout.trim();
  }
  const diff = git(repositoryRoot, [
    "diff",
    "--no-color",
    "--no-ext-diff",
    "--diff-filter=AMR",
    "-U0",
    ...(staged ? ["--cached"] : []),
    ...(comparison === undefined ? [] : [comparison]),
    "--",
    ...emDashScopes,
  ]);
  if (diff.status !== 0) {
    throw new Error(`git diff failed: ${diff.stderr.trim()}`);
  }
  return {
    base: comparison ?? "index",
    findings: findAddedEmDashes(diff.stdout),
  };
}

function run() {
  const args = process.argv.slice(2);
  const staged = args.includes("--staged");
  const baseIndex = args.indexOf("--base");
  const base = baseIndex === -1 ? undefined : args[baseIndex + 1];
  if (baseIndex !== -1 && (base === undefined || base.startsWith("--"))) {
    console.error("New em dash check: --base requires a revision.");
    process.exitCode = 1;
    return;
  }
  const { base: compared, findings } = checkNewEmDashes({ base, staged });
  if (compared === undefined) {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      console.error(
        "New em dash check: origin/main is unavailable; fetch full history (fetch-depth: 0).",
      );
      process.exitCode = 1;
      return;
    }
    console.warn(
      "New em dash check skipped: origin/main is unavailable for a comparison base.",
    );
    return;
  }
  if (findings.length > 0) {
    console.error(
      `New em dash check failed (${findings.length}): use a period, comma or parentheses instead of "${emDash}".`,
    );
    for (const { file, line, text } of findings) {
      console.error(`- ${file}:${line}: ${text}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log("New em dash check passed.");
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  run();
}
