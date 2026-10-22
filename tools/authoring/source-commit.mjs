// @ts-check
// A delivery may move a row forward along Content history, never back or sideways (#1672):
// on 2026-10-19 an older prepared package replaced a newer production article.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  canonical,
  checksum,
  contentMaterials,
  contentTasks,
  loadPackage,
  materialRevision,
} from "./package.mjs";
import { refusal } from "./refusal.mjs";

const execute = promisify(execFile);

/** @typedef {(ancestor: string, descendant: string) => Promise<boolean>} IsAncestor */

/**
 * Git ancestry in the Content repository; an unknown commit is an error, not "not an ancestor".
 *
 * @param {string} repository
 * @returns {IsAncestor}
 */
export function gitAncestry(repository) {
  return async (ancestor, descendant) => {
    for (const commit of [ancestor, descendant])
      await execute("git", [
        "-C",
        repository,
        "cat-file",
        "-e",
        `${commit}^{commit}`,
      ]).catch((error) => {
        throw new Error(
          `Content repository ${repository} does not contain commit ${commit}; fetch it before delivering`,
          { cause: error },
        );
      });
    try {
      await execute("git", [
        "-C",
        repository,
        "merge-base",
        "--is-ancestor",
        ancestor,
        descendant,
      ]);
      return true;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === 1)
        return false;
      throw error;
    }
  };
}

/**
 * How the package commit relates to the commit the target recorded for the same row.
 * `unrecorded` means the target's current content came from an import that named no commit.
 *
 * @param {string | null | undefined} targetCommit
 * @param {string} packageCommit
 * @param {IsAncestor} isAncestor
 * @returns {Promise<"same" | "forward" | "unrecorded" | "older" | "diverged">}
 */
export async function sourceCommitRelation(
  targetCommit,
  packageCommit,
  isAncestor,
) {
  if (targetCommit === null || targetCommit === undefined) return "unrecorded";
  if (targetCommit === packageCommit) return "same";
  if (await isAncestor(targetCommit, packageCommit)) return "forward";
  return (await isAncestor(packageCommit, targetCommit)) ? "older" : "diverged";
}

/**
 * The committed HEAD of the Content repository; the working tree never counts.
 *
 * @param {string} repository
 */
async function gitHead(repository) {
  const { stdout } = await execute("git", [
    "-C",
    repository,
    "rev-parse",
    "--verify",
    "HEAD^{commit}",
  ]);
  return stdout.trim();
}

/**
 * @typedef {(repository: string, guide: string, stateDirectory: string, ref: string) => Promise<{ commit: string; packagePath: string }>} ExportPackage
 */

/**
 * The selected rows as the exporter produced them; equal rows mean equal delivered content.
 *
 * @param {import("./package.mjs").Manifest} manifest
 */
function selectedContent(manifest) {
  return new Map([
    ...contentMaterials(manifest).map(
      (row) =>
        /** @type {const} */ ([
          `material:${row.sourceId}`,
          materialRevision(manifest, row),
        ]),
    ),
    ...contentTasks(manifest).map(
      (task) =>
        /** @type {const} */ ([
          `task:${task.sourceId}`,
          checksum(
            canonical({
              // Provenance names the export commit, so it differs between any two commits.
              task: {
                ...task,
                provenance: { ...task.provenance, commit: null },
              },
              page:
                task.page === undefined
                  ? null
                  : materialRevision(manifest, task.page),
            }),
          ),
        ]),
    ),
  ]);
}

/**
 * Binds the package to Content history (#1672). The official export of the named commit must
 * produce the same selected rows, and the export of the repository's HEAD must too: otherwise the
 * package is not the commit it claims, or a newer commit already changed what it would deliver.
 *
 * @param {import("./package.mjs").AuthoringPackage} pkg
 * @param {{
 *   repository: string;
 *   commit: string;
 *   stateDirectory: string;
 *   exportPackage: ExportPackage;
 *   resolveHead?: (repository: string) => Promise<string>;
 * }} options
 */
export async function verifyPackageSource(
  pkg,
  { repository, commit, stateDirectory, exportPackage, resolveHead = gitHead },
) {
  const guide = pkg.manifest.selection.productId;
  if (guide === null)
    throw refusal(
      "package_guide_missing",
      "A content-only package names its Guide in selection.productId",
    );
  const wanted = selectedContent(pkg.manifest);
  /** @param {string} ref */
  const differing = async (ref) => {
    const exported = await exportPackage(
      repository,
      guide,
      stateDirectory,
      ref,
    );
    const rows = selectedContent(
      (await loadPackage(exported.packagePath)).manifest,
    );
    return {
      commit: exported.commit,
      rows: [...wanted]
        .filter(([key, value]) => rows.get(key) !== value)
        .map(([key]) => key),
    };
  };
  const named = await differing(commit);
  if (named.commit !== commit)
    throw refusal(
      "package_commit_mismatch",
      `${commit} resolves to ${named.commit} in ${repository}`,
    );
  if (named.rows.length > 0)
    throw refusal(
      "package_commit_mismatch",
      `The package does not match the export of Content ${commit}: ${named.rows.join(", ")}`,
    );
  const headCommit = await resolveHead(repository);
  if (headCommit === commit) return { head: commit };
  const head = await differing(headCommit);
  if (head.rows.length > 0)
    throw refusal(
      "source_newer_in_repository",
      `Content ${head.commit} (HEAD) already changed ${head.rows.join(", ")} after ${commit}; export the current commit instead`,
    );
  return { head: head.commit };
}
