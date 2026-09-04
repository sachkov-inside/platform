#!/usr/bin/env node

import { readFile } from "node:fs/promises";

import {
  parseSchema,
  releaseManifestSchema,
} from "../release/contract-schema.mjs";

const [command, inputFlag, inputPath] = process.argv.slice(2);

try {
  if (command !== "plan" || inputFlag !== "--manifest" || !inputPath) {
    throw new Error("usage: runtime-contract.mjs plan --manifest <path>");
  }
  const manifest = parseSchema(
    releaseManifestSchema,
    JSON.parse(await readFile(inputPath, "utf8")),
    "runtime manifest",
  );
  const backendImage = splitDigestReference(manifest.images.backend);
  const webImage = splitDigestReference(manifest.images.web);
  process.stdout.write(`${JSON.stringify({
    schemaVersion: "inside.platform.runtime-plan.v1",
    release: {
      version: manifest.version,
      sourceSha: manifest.source.sha,
    },
    images: manifest.images,
    composeEnvironment: {
      PLATFORM_BACKEND_IMAGE_DIGEST: backendImage.digest,
      PLATFORM_BACKEND_IMAGE_REPOSITORY: backendImage.repository,
      PLATFORM_RELEASE_VERSION: manifest.version,
      PLATFORM_SOURCE_SHA: manifest.source.sha,
      PLATFORM_WEB_IMAGE_DIGEST: webImage.digest,
      PLATFORM_WEB_IMAGE_REPOSITORY: webImage.repository,
    },
  }, null, 2)}\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : "runtime contract failed";
  process.stderr.write(`runtime contract: ${message}\n`);
  process.exitCode = 1;
}

function splitDigestReference(reference) {
  const separator = "@sha256:";
  const index = reference.lastIndexOf(separator);
  if (index <= 0) {
    throw new Error("manifest image is not a sha256 digest reference");
  }
  return {
    repository: reference.slice(0, index),
    digest: reference.slice(index + separator.length),
  };
}
