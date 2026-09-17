import { execFileSync } from "node:child_process";
import { lstatSync, readlinkSync, symlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";

// Every checkout of this repository shares one local stand, so it must share the stand's sign-in keys.
// A linked worktree therefore points `.identity-proof` at the primary checkout instead of generating
// its own keys, which would silently detach the owner's stand accounts.
export function ensureSharedIdentityDirectory(root, { git = (args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim() } = {}) {
  const commonDirectory = resolve(root, git(["rev-parse", "--git-common-dir"]));
  const primary = dirname(commonDirectory);
  const local = resolve(root, ".identity-proof");
  if (resolve(primary) === resolve(root)) return local;
  const shared = resolve(primary, ".identity-proof");
  const current = lstatSync(local, { throwIfNoEntry: false });
  if (current === undefined) {
    symlinkSync(shared, local, "dir");
    return shared;
  }
  if (current.isSymbolicLink() && resolve(dirname(local), readlinkSync(local)) === shared) return shared;
  throw new Error(`${local} is not the shared stand identity directory; move its files to ${shared} and remove it`);
}
