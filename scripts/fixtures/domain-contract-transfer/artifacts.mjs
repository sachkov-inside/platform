import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
export const artifactAlgorithm =
  "sha256(sorted POSIX path + NUL + sha256(file bytes) + LF), regular files only";

export async function sourceIdentity(context) {
  const git = async (...args) =>
    (await execute("git", ["-C", context, ...args])).stdout.trim();
  if (await git("status", "--porcelain", "--untracked-files=no"))
    throw new Error("Artifact context has tracked source changes");
  return [
    await git("rev-parse", "HEAD"),
    await git("rev-parse", "HEAD^{tree}"),
  ];
}

export async function hashArtifact(base, prefix) {
  const files = [];
  async function walk(path, relative = "") {
    for (const name of await readdir(path)) {
      const full = resolve(path, name);
      const rel = relative ? `${relative}/${name}` : name;
      const stat = await lstat(full);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) await walk(full, rel);
      else if (stat.isFile())
        files.push([
          `${prefix}/${rel}`,
          createHash("sha256")
            .update(await readFile(full))
            .digest("hex"),
        ]);
    }
  }
  await walk(base);
  files.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  if (files.length === 0) throw new Error(`Empty artifact: ${base}`);
  return {
    files: files.length,
    sha256: createHash("sha256")
      .update(files.map(([path, hash]) => `${path}\0${hash}\n`).join(""))
      .digest("hex"),
  };
}
