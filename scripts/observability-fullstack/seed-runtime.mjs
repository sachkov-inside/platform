// @ts-check
/** Compile only the existing development corpus into this fixture's fresh tmpfs. */
import { lstatSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCES = [
  "seed-local",
  "seed-local-development",
  "seed-local-offer-catalog",
];
const MAX_SOURCE_BYTES = 65536;

/** @param {string | URL} source @param {string} target */
export function prepareDevelopmentCorpus(source, target) {
  const root = typeof source === "string" ? source : fileURLToPath(source);
  const destination = lstatSync(target);
  if (
    !destination.isDirectory() ||
    destination.isSymbolicLink() ||
    readdirSync(target).length !== 0
  )
    throw new Error("fresh_seed_directory");
  const compiled = SOURCES.map((name) => {
    const path = join(root, name + ".ts");
    const info = lstatSync(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_SOURCE_BYTES)
      throw new Error("seed_source_file");
    const raw = readFileSync(path, "utf8");
    if (Buffer.byteLength(raw) > MAX_SOURCE_BYTES)
      throw new Error("seed_source_file");
    return { name, code: stripTypeScriptTypes(raw) };
  });
  for (const { name, code } of compiled)
    writeFileSync(join(target, name + ".js"), code, {
      flag: "wx",
      mode: 0o600,
    });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (
    process.env["INSIDE_RESOURCE_SEED_ENABLED"] !== "true" ||
    process.env["NODE_ENV"] !== "development"
  )
    throw new Error("resource_seed_disabled");
  prepareDevelopmentCorpus("/resource/development", "/app/dist/development");
  const entry = new URL("file:///app/dist/development/seed-local.js");
  await import(entry.href);
}
