// @ts-check
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { deterministicTestViolations } from "./deterministic-tests.mjs";

const root = path.resolve(process.argv[2] ?? ".");
const ignored = new Set([
  "node_modules",
  "fixtures",
  ".next",
  "dist",
  "build",
  ".git",
]);
/** @param {string} directory @returns {string[]} */
function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (ignored.has(entry.name)) return [];
    const file = path.join(directory, entry.name);
    return entry.isDirectory()
      ? files(file)
      : /\.[cm]?[jt]sx?$/u.test(file)
        ? [file]
        : [];
  });
}
const findings = files(root).flatMap((file) => {
  const relative = path.relative(root, file).split(path.sep).join("/");
  const testSource =
    /(?:^|\/)test\//u.test(relative) ||
    /\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(relative);
  const diagnostic = /^(?:apps\/[^/]+\/)?scripts\//u.test(relative);
  if (!testSource && !diagnostic) return [];
  const source = readFileSync(file, "utf8");
  return deterministicTestViolations(relative, source, testSource);
});
if (findings.length > 0) {
  process.stderr.write(`${findings.sort().join("\n")}\n`);
  process.exitCode = 1;
} else process.stdout.write("Deterministic test syntax passed.\n");
