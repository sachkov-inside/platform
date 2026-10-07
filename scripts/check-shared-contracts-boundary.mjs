// @ts-check
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

const root = path.resolve(process.argv[2] ?? ".");
const authority = path.join(root, "docs/contracts");
const ignored = new Set([
  "node_modules",
  "dist",
  ".next",
  "coverage",
  "storybook-static",
  ".git",
]);
const schemaIdentity = z.object({ $id: z.string() }).passthrough();
/** @param {string} directory @returns {string[]} */
function files(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory())
      return ignored.has(entry.name) ||
        file === path.join(root, "docs/history") ||
        file === path.join(root, "docs/research")
        ? []
        : files(file);
    return entry.isFile() && /\.(json|md|txt)$/u.test(entry.name) ? [file] : [];
  });
}
/** @param {string} file */
function digest(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}
/** @param {string} file */
function identity(file) {
  if (!file.endsWith(".json")) return undefined;
  const parsed = schemaIdentity.safeParse(
    JSON.parse(readFileSync(file, "utf8")),
  );
  return parsed.success ? parsed.data.$id : undefined;
}
const canonical = files(authority).filter(
  (file) => !/\/(package|manifest|snapshot|provenance)\.json$/u.test(file),
);
/** @type {Map<string, string>} */
const digests = new Map();
/** @type {Map<string, string>} */
const identities = new Map();
/** @type {string[]} */
const duplicateSources = [];
for (const file of canonical) {
  const hash = digest(file);
  const id = identity(file);
  const owner =
    digests.get(hash) ?? (id === undefined ? undefined : identities.get(id));
  if (owner !== undefined)
    duplicateSources.push(
      `${path.relative(root, file)}: duplicates canonical contract ${path.relative(root, owner)}`,
    );
  digests.set(hash, file);
  if (id !== undefined) identities.set(id, file);
}
const corpusNames = new Set(
  readdirSync(authority, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name),
);
const findings = duplicateSources.concat(
  ["apps", "packages", "docs"]
    .flatMap((directory) => files(path.join(root, directory)))
    .filter((file) => !file.startsWith(`${authority}${path.sep}`))
    .flatMap((file) => {
      const id = identity(file);
      const owner =
        digests.get(digest(file)) ??
        (id === undefined ? undefined : identities.get(id));
      const relative = path.relative(root, file);
      const copiedFolder = relative
        .split(path.sep)
        .some((part) => corpusNames.has(part));
      return owner !== undefined || copiedFolder
        ? [
            `${relative}: shared contract belongs to ${owner === undefined ? "docs/contracts" : path.relative(root, owner)}; import @inside/contracts instead of copying it`,
          ]
        : [];
    }),
);
if (findings.length > 0) {
  process.stderr.write(`${findings.sort().join("\n")}\n`);
  process.exitCode = 1;
} else process.stdout.write("Shared contracts boundary passed.\n");
