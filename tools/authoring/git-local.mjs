import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { syncLocal } from "./local-sync.mjs";
import { writeAtomic } from "./journal.mjs";
import { resolveLocalTarget } from "./target.mjs";

const execute = promisify(execFile);
const commandOptions = { timeout: 120_000, maxBuffer: 1024 * 1024 };

// Resolve once: later commits, staged edits and working-copy files cannot enter this snapshot.
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
    await mkdir(snapshot);
    const archive = join(temporary, "source.tar");
    await execute(
      "git",
      ["-C", root, "archive", "--format=tar", `--output=${archive}`, commit],
      commandOptions,
    );
    await execute("tar", ["-xf", archive, "-C", snapshot], commandOptions);
    return await use({ snapshot, commit });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

export async function syncGitLocal(
  repository,
  guideId,
  stateDirectory,
  ref = "HEAD",
  options = {},
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
    const packagePath = resolve(stdout.trim(), "package.json");
    const report = await syncLocal(packagePath, state, options);
    const receipt = {
      commit,
      guideId,
      packagePath,
      completedAt: new Date().toISOString(),
      ...report,
    };
    await writeAtomic(join(state, "last-git-sync.json"), receipt);
    return receipt;
  });
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
    },
  });
  const [repository, guideId, state, ref = "HEAD", ...extra] = positionals;
  if (!repository || !guideId || !state || extra.length)
    throw new Error(
      "Usage: pnpm authoring:sync-git-local CONTENT_REPOSITORY GUIDE_ID STATE_DIRECTORY [REF=HEAD] [--target editor|stand] [--archive SOURCE_ID]... [--pin-home]",
    );
  const report = await syncGitLocal(repository, guideId, state, ref, {
    origin: resolveLocalTarget(values.target),
    archive: values.archive,
    pinHome: values["pin-home"],
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
        notices: report.notices,
      },
      null,
      2,
    ),
  );
}
