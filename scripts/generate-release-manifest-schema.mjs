#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { z } from "zod";

import { releaseManifestSchema } from "../release/contract-schema.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = resolve(repositoryRoot, "release/manifest.schema.json");
const generated = z.toJSONSchema(releaseManifestSchema, {
  target: "draft-2020-12",
  reused: "ref",
});
generated.$id =
  "https://github.com/sachkov-inside/platform/blob/main/release/manifest.schema.json";
const contents = `${JSON.stringify(generated, null, 2)}\n`;

if (process.argv[2] === "--check") {
  const current = await readFile(outputPath, "utf8");
  if (current !== contents) {
    throw new Error("release/manifest.schema.json is not generated from its Zod owner");
  }
  process.stdout.write("Release manifest schema is up to date.\n");
} else {
  await writeFile(outputPath, contents);
  process.stdout.write("Generated release/manifest.schema.json.\n");
}
