import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const repositoryRoot = path.resolve(process.argv[2] ?? ".");

if (!statSync(repositoryRoot).isDirectory()) {
  throw new TypeError(`Workshop boundary root is not a directory: ${repositoryRoot}`);
}

const findings = [];
const backendSource = path.join(repositoryRoot, "apps/backend/src");
if (existsDirectory(backendSource)) {
  for (const filename of sourceFiles(backendSource)) {
    const source = readFileSync(filename, "utf8");
    const controlsProcesses =
      /(?:from\s+["']node:child_process["']|require\(["']node:child_process["']\))/u.test(
        source,
      );
    const namesWorkshopRuntime =
      /(?:workshop-evaluator|\.inside\/assignment\.json|docker\s+compose)/iu.test(source);
    if (
      namesWorkshopRuntime &&
      (controlsProcesses || /(?:spawn|exec)(?:File|Sync)?\s*\(/u.test(source))
    ) {
      findings.push(
        `${relative(filename)}: participant evaluator execution is forbidden in Platform runtime`,
      );
    }
  }
}

for (const relativeFilename of [
  "apps/backend/package.json",
  "apps/backend/Dockerfile",
  "compose.yaml",
  "compose.production.yaml",
]) {
  const filename = path.join(repositoryRoot, relativeFilename);
  if (!existsFile(filename)) continue;
  const source = readFileSync(filename, "utf8");
  if (
    /(?:tools\/workshop-evaluator|workshop-evaluator|\/var\/run\/docker\.sock|privileged:\s*true)/iu.test(
      source,
    )
  ) {
    findings.push(
      `${relativeFilename}: Platform Compose and backend artifacts cannot own participant evaluator execution`,
    );
  }
}

if (findings.length > 0) {
  process.stderr.write(`${findings.sort().join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("Workshop participant-runtime boundary passed.\n");
}

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(filename);
    return /\.(?:cts|mts|ts)(?:\.fixture)?$/u.test(entry.name) ? [filename] : [];
  });
}

function existsDirectory(filename) {
  try {
    return statSync(filename).isDirectory();
  } catch {
    return false;
  }
}

function existsFile(filename) {
  try {
    return statSync(filename).isFile();
  } catch {
    return false;
  }
}

function relative(filename) {
  return path.relative(repositoryRoot, filename).split(path.sep).join("/");
}
