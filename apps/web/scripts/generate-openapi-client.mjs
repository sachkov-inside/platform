import {
  cpSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const mode = process.argv[2];
if (mode !== "generate" && mode !== "check") {
  throw new Error("Expected generate or check mode");
}

const appRoot = resolve(import.meta.dirname, "..");
const schemaPath = resolve(appRoot, "../backend/openapi/platform-api.json");
const outputPath = resolve(
  appRoot,
  "src/shared/api/backend/generated/platform-api",
);
const temporaryRoot = mkdtempSync(join(tmpdir(), "inside-openapi-"));
const generatedPath = join(temporaryRoot, "platform-api");
let exitCode = 0;

try {
  const generation = spawnSync(
    "openapi",
    [
      "--input",
      schemaPath,
      "--output",
      generatedPath,
      "--client",
      "fetch",
      "--name",
      "PlatformApiClient",
      "--useOptions",
      "--useUnionTypes",
      "--indent",
      "2",
    ],
    { encoding: "utf8", stdio: "pipe" },
  );

  if (generation.status !== 0) {
    process.stderr.write(generation.stderr);
    exitCode = generation.status ?? 1;
  } else {
    normalizeGeneratedFiles(generatedPath);
  }

  if (exitCode === 0) {
    if (mode === "generate") {
      rmSync(outputPath, { force: true, recursive: true });
      cpSync(generatedPath, outputPath, { recursive: true });
      process.stdout.write("Generated the Platform API client.\n");
    } else {
      const differences = compareDirectories(outputPath, generatedPath);
      if (differences.length > 0) {
        process.stderr.write(
          `Generated Platform API client is stale:\n${differences.map((entry) => `- ${entry}`).join("\n")}\n`,
        );
        exitCode = 1;
      }
    }
  }
} finally {
  rmSync(temporaryRoot, { force: true, recursive: true });
}
process.exitCode = exitCode;

function normalizeGeneratedFiles(root) {
  removeUnusedGeneratedRuntime(root);

  for (const file of listFiles(root)) {
    const path = join(root, file);
    writeFileSync(path, `${readFileSync(path, "utf8").trimEnd()}\n`);
  }
}

function removeUnusedGeneratedRuntime(root) {
  for (const file of [
    "PlatformApiClient.ts",
    "core/FetchHttpRequest.ts",
    "core/request.ts",
  ]) {
    rmSync(join(root, file), { force: true });
  }

  const indexPath = join(root, "index.ts");
  const indexSource = readFileSync(indexPath, "utf8").replace(
    "export { PlatformApiClient } from './PlatformApiClient';\n\n",
    "",
  );
  writeFileSync(indexPath, indexSource);
}

function compareDirectories(actualRoot, expectedRoot) {
  const actualFiles = listFiles(actualRoot);
  const expectedFiles = listFiles(expectedRoot);
  const allFiles = [...new Set([...actualFiles, ...expectedFiles])].sort();

  return allFiles.filter((file) => {
    if (!actualFiles.includes(file) || !expectedFiles.includes(file)) {
      return true;
    }
    return (
      readFileSync(join(actualRoot, file), "utf8") !==
      readFileSync(join(expectedRoot, file), "utf8")
    );
  });
}

function listFiles(root) {
  try {
    return readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => relative(root, join(entry.parentPath, entry.name)))
      .sort();
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}
