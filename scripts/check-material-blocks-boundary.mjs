import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const repositoryRoot = path.resolve(process.argv[2] ?? ".");

if (!statSync(repositoryRoot).isDirectory()) {
  throw new TypeError(`Material blocks boundary root is not a directory: ${repositoryRoot}`);
}

const packageRoot = path.join(repositoryRoot, "packages/material-blocks");
const registryEntry = path.join(packageRoot, "src/index.ts");
const findings = [];

if (!existsSync(registryEntry)) {
  findings.push("packages/material-blocks/src/index.ts: the block registry entry point is missing");
}

const importSpecifier = /(?:^|[\s;])(?:import|export)\b[^'"]*?from\s*["']([^"']+)["']/gmu;
const sideEffectImport = /(?:^|[\s;])import\s*["']([^"']+)["']/gmu;

const visited = new Set();
const pending = existsSync(registryEntry) ? [registryEntry] : [];
while (pending.length > 0) {
  const filename = pending.pop();
  if (visited.has(filename)) continue;
  visited.add(filename);
  const source = readFileSync(filename, "utf8");
  for (const pattern of [importSpecifier, sideEffectImport]) {
    pattern.lastIndex = 0;
    let match = pattern.exec(source);
    while (match !== null) {
      const specifier = match[1];
      if (specifier.startsWith("@tiptap/")) {
        findings.push(
          `${relative(filename)}: the block registry entry point cannot depend on Tiptap; the reading path imports it (${specifier})`,
        );
      }
      const local = resolveLocal(filename, specifier);
      if (local !== undefined) pending.push(local);
      match = pattern.exec(source);
    }
  }
}

if (findings.length > 0) {
  process.stderr.write(`${[...new Set(findings)].sort().join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("Material block registry boundary passed.\n");
}

function resolveLocal(importer, specifier) {
  if (!specifier.startsWith(".")) return undefined;
  const base = path.resolve(path.dirname(importer), specifier);
  for (const candidate of [
    base.replace(/\.js$/u, ".ts"),
    `${base}.ts`,
    path.join(base, "index.ts"),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return undefined;
}

function relative(filename) {
  return path.relative(repositoryRoot, filename).split(path.sep).join("/");
}
