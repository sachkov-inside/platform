// @ts-check
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { publishOption, syncLocal } from "./local-sync.mjs";
import { writeAtomic } from "./journal.mjs";
import { resolveLocalTarget } from "./target.mjs";
import { prepareCoursePreview } from "./course-preview.mjs";

const execute = promisify(execFile);
const commandOptions = { timeout: 120_000, maxBuffer: 1024 * 1024 };

/**
 * Resolve once: later commits, staged edits and working-copy files cannot enter this snapshot.
 *
 * @template T
 * @param {string} repository
 * @param {string} ref
 * @param {(snapshot: { snapshot: string; commit: string }) => T | Promise<T>} use
 * @returns {Promise<T>}
 */
export async function withGitSnapshot(repository, ref, use) {
  const root = resolve(repository);
  const { stdout } = await execute(
    "git",
    [
      "-C",
      root,
      "rev-parse",
      "--verify",
      "--end-of-options",
      `${ref}^{commit}`,
    ],
    commandOptions,
  );
  const commit = stdout.trim();
  const temporary = await mkdtemp(join(tmpdir(), "inside-content-commit-"));
  try {
    const snapshot = join(temporary, "source");
    // Practice provenance reads HEAD and its committed sidecar. An archive has no Git metadata.
    // This private clone shares only immutable objects, never the owner's index or working tree.
    await execute(
      "git",
      ["clone", "--shared", "--no-checkout", "--quiet", "--", root, snapshot],
      commandOptions,
    );
    await execute(
      "git",
      [
        "-C",
        snapshot,
        "-c",
        "core.hooksPath=/dev/null",
        "checkout",
        "--detach",
        commit,
      ],
      commandOptions,
    );
    return await use({ snapshot, commit });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

/**
 * Exports one committed Content revision as an immutable package under `STATE/packages`; staged,
 * unstaged and untracked files never enter it.
 *
 * @param {string} repository
 * @param {string} guideId
 * @param {string} stateDirectory
 * @param {string} [ref]
 */
export async function exportCommittedPackage(
  repository,
  guideId,
  stateDirectory,
  ref = "HEAD",
) {
  const state = resolve(stateDirectory);
  await mkdir(state, { recursive: true });
  return withGitSnapshot(repository, ref, async ({ snapshot, commit }) => {
    process.stderr.write(`Preparing committed content ${commit}\n`);
    const { stdout } = await execute(
      "uv",
      [
        "run",
        "--frozen",
        "python",
        "tools/content.py",
        "export-platform",
        "--guide",
        guideId,
        "--output",
        join(state, "packages"),
      ],
      { ...commandOptions, cwd: snapshot },
    );
    return { commit, packagePath: resolve(stdout.trim(), "package.json") };
  });
}

/**
 * @param {string} repository
 * @param {string} guideId
 * @param {string} stateDirectory
 * @param {string} [ref]
 * @param {import("./local-sync.mjs").SyncOptions & { coursePreview?: boolean }} [options]
 */
export async function syncGitLocal(
  repository,
  guideId,
  stateDirectory,
  ref = "HEAD",
  options = {},
) {
  const state = resolve(stateDirectory);
  const { commit, packagePath: originalPackagePath } =
    await exportCommittedPackage(repository, guideId, state, ref);
  const { coursePreview = false, ...syncOptions } = options;
  const packagePath = coursePreview
    ? await prepareCoursePreview(originalPackagePath, state)
    : originalPackagePath;
  const report = await syncLocal(packagePath, state, syncOptions);
  const receipt = {
    commit,
    guideId,
    packagePath,
    originalPackagePath,
    coursePreview,
    completedAt: new Date().toISOString(),
    ...report,
  };
  await writeAtomic(join(state, "last-git-sync.json"), receipt);
  return receipt;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      target: { type: "string", default: "editor" },
      archive: { type: "string", multiple: true, default: [] },
      "pin-home": { type: "boolean", default: false },
      publish: { type: "string", multiple: true, default: [] },
      "publish-all": { type: "boolean", default: false },
    },
  });
  const [repository, guideId, state, ref = "HEAD", ...extra] = positionals;
  if (!repository || !guideId || !state || extra.length)
    throw new Error(
      "Usage: pnpm authoring:sync-git-local CONTENT_REPOSITORY GUIDE_ID STATE_DIRECTORY [REF=HEAD] [--target editor|stand] [--publish SOURCE_ID]... [--publish-all] [--archive SOURCE_ID]... [--pin-home]",
    );
  const report = await syncGitLocal(repository, guideId, state, ref, {
    origin: resolveLocalTarget(values.target),
    archive: values.archive,
    pinHome: values["pin-home"],
    publish: publishOption(values),
  });
  console.log(
    JSON.stringify(
      {
        commit: report.commit,
        packageId: report.packageId,
        applied: report.applied,
        unchanged: report.unchanged,
        guides: report.guides,
        archived: report.archived,
        archiveProposals: report.archiveProposals,
        tasks: report.tasks ?? [],
        notices: report.notices,
      },
      null,
      2,
    ),
  );
}
