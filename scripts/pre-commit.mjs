// @ts-check
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { checkDocumentation } from "./check-agent-documentation.mjs";
import { checkMaterialsDocumentation } from "./check-materials-documentation.mjs";
import { checkNewEmDashes } from "./check-new-em-dashes.mjs";

/**
 * Fast staged-file checks before a commit: Prettier on the staged bytes, the documentation
 * contracts when Markdown or package scripts change, and new em dashes in staged copy.
 * CI keeps the complete checks; this hook only moves the most frequent failures earlier.
 */

const scriptPath = fileURLToPath(import.meta.url);
const defaultRepositoryRoot = resolve(dirname(scriptPath), "..");

/**
 * @param {string} repositoryRoot
 * @param {string[]} args
 */
function git(repositoryRoot, args) {
  const result = spawnSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`git ${args[0]} failed: ${result.stderr.trim()}`);
  }
  return result.stdout;
}

/** @param {string} repositoryRoot */
export function stagedFiles(repositoryRoot) {
  return git(repositoryRoot, [
    "diff",
    "--cached",
    "--name-only",
    "--diff-filter=ACMR",
    "-z",
  ])
    .split("\0")
    .filter(Boolean);
}

/** @param {string} path */
export function needsDocumentationCheck(path) {
  return path.endsWith(".md") || path.endsWith("package.json");
}

/**
 * Staged files whose staged content Prettier would reformat. Files Prettier ignores or cannot
 * parse are skipped, as with `prettier --check --ignore-unknown`.
 *
 * @param {string} repositoryRoot
 * @param {string[]} files
 * @param {typeof import("prettier")} prettier
 */
export async function unformattedFiles(repositoryRoot, files, prettier) {
  const ignorePath = [
    resolve(repositoryRoot, ".gitignore"),
    resolve(repositoryRoot, ".prettierignore"),
  ];
  /** @type {string[]} */
  const unformatted = [];
  for (const file of files) {
    const filepath = resolve(repositoryRoot, file);
    const info = await prettier.getFileInfo(filepath, { ignorePath });
    if (info.ignored || info.inferredParser === null) {
      continue;
    }
    const source = git(repositoryRoot, ["show", `:${file}`]);
    const options = (await prettier.resolveConfig(filepath)) ?? {};
    if (!(await prettier.check(source, { ...options, filepath }))) {
      unformatted.push(file);
    }
  }
  return unformatted;
}

/** @param {string} repositoryRoot */
export async function runPreCommit(repositoryRoot = defaultRepositoryRoot) {
  /** @type {string[]} */
  const failures = [];
  const files = stagedFiles(repositoryRoot);
  if (files.length === 0) {
    return failures;
  }

  /** @type {typeof import("prettier") | undefined} */
  let prettier;
  try {
    prettier = await import("prettier");
  } catch {
    console.warn(
      "pre-commit: Prettier is not installed (run pnpm install); formatting check skipped",
    );
  }
  if (prettier) {
    const unformatted = await unformattedFiles(repositoryRoot, files, prettier);
    if (unformatted.length > 0) {
      failures.push(
        `Prettier would reformat staged files; run: pnpm exec prettier --write ${unformatted.join(" ")}`,
      );
    }
  }

  if (files.some(needsDocumentationCheck)) {
    failures.push(
      ...checkDocumentation(repositoryRoot),
      ...checkMaterialsDocumentation(repositoryRoot),
    );
  }

  for (const { file, line, text } of checkNewEmDashes({
    repositoryRoot,
    staged: true,
  }).findings) {
    failures.push(`New em dash in ${file}:${line}: ${text}`);
  }
  return failures;
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  const failures = await runPreCommit();
  if (failures.length > 0) {
    console.error("pre-commit failed (skip once with git commit --no-verify):");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
  }
}
