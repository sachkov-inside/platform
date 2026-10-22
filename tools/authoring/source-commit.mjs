// @ts-check
// A delivery may move a row forward along Content history, never back or sideways (#1672):
// on 2026-10-19 an older prepared package replaced a newer production article.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

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
