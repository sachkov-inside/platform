import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const policy = JSON.parse(
  readFileSync(
    resolve(repositoryRoot, "infra/production/database/backup-policy.json"),
    "utf8",
  ),
);

export function validateRecoveryEvidence(input) {
  if (
    typeof input !== "object" ||
    input === null ||
    input.schemaVersion !== 1 ||
    !Array.isArray(input.drills)
  ) {
    throw new Error("Recovery evidence must use schemaVersion 1 and drills");
  }
  const modes = new Set();
  for (const drill of input.drills) {
    if (typeof drill !== "object" || drill === null) {
      throw new Error("Recovery drill entry is invalid");
    }
    if (drill.mode !== "pitr" && drill.mode !== "empty-host") {
      throw new Error("Recovery drill mode must be pitr or empty-host");
    }
    modes.add(drill.mode);
    if (
      !Array.isArray(drill.databases) ||
      JSON.stringify([...drill.databases].sort()) !==
        JSON.stringify([...policy.targets.databases].sort())
    ) {
      throw new Error(`${drill.mode}: both recovery databases are required`);
    }
    if (
      typeof drill.backupSet !== "string" ||
      drill.backupSet.length === 0 ||
      typeof drill.targetTimestamp !== "string" ||
      Number.isNaN(Date.parse(drill.targetTimestamp))
    ) {
      throw new Error(`${drill.mode}: backup set and target timestamp are required`);
    }
    for (const [name, maximum] of [
      ["rpoSeconds", policy.targets.rpoSeconds],
      ["rtoSeconds", policy.targets.rtoSeconds],
    ]) {
      if (
        typeof drill[name] !== "number" ||
        !Number.isFinite(drill[name]) ||
        drill[name] < 0 ||
        drill[name] > maximum
      ) {
        throw new Error(`${drill.mode}: ${name} exceeds target`);
      }
    }
  }
  if (!modes.has("pitr") || !modes.has("empty-host")) {
    throw new Error("PITR and empty-host evidence are both required");
  }
  return input;
}

function run() {
  const path = process.argv[2];
  if (path === undefined) throw new Error("Evidence path is required");
  validateRecoveryEvidence(JSON.parse(readFileSync(resolve(path), "utf8")));
  console.log("Database recovery evidence meets RPO/RTO targets");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    run();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Recovery evidence is invalid");
    process.exitCode = 1;
  }
}
