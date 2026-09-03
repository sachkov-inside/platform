#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";

import {
  backendImageName,
  ordinalVersionSchema,
  parseSchema,
  releaseAssetNames,
  releaseImageResultSchema,
  releaseManifestInputSchema,
  releaseManifestSchema,
  releasePlanInputSchema,
  webImageName,
} from "../release/contract-schema.mjs";

const [command, inputFlag, inputPath] = process.argv.slice(2);

try {
  if (inputFlag !== "--input" || !inputPath) {
    throw new Error("usage: release-contract.mjs <command> --input <path>");
  }

  const input = JSON.parse(
    await readFile(inputPath === "-" ? 0 : inputPath, "utf8"),
  );

  if (command === "plan") {
    writeResult(planRelease(input));
  } else if (command === "manifest") {
    writeResult(await createManifest(input));
  } else {
    throw new Error(`unknown release contract command: ${command ?? ""}`);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : "release contract failed";
  process.stderr.write(`release contract: ${message}\n`);
  process.exitCode = 1;
}

function writeResult(result) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function planRelease(input) {
  input = parseSchema(releasePlanInputSchema, input, "release plan");
  const ordinal = parseOrdinalVersion(input.requestedVersion);
  const ordinalReleases = input.existingReleases.filter(({ version }) =>
    ordinalVersionSchema.safeParse(version).success,
  );
  const existingVersions = ordinalReleases.map(({ version }) => version);

  for (const release of ordinalReleases) {
    if (!release.immutable) {
      throw new Error(`${release.version} is not an immutable published release`);
    }
    const missingAssets = releaseAssetNames.filter(
      (asset) => !release.assets.includes(asset),
    );
    if (missingAssets.length > 0) {
      throw new Error(
        `${release.version} is missing retained release assets: ${missingAssets.join(", ")}`,
      );
    }
  }

  const uniqueTags = [
    ...new Set(
      input.existingTags.filter((tag) =>
        ordinalVersionSchema.safeParse(tag).success,
      ),
    ),
  ].sort();
  const uniqueReleases = [...new Set(existingVersions)].sort();
  if (!isDeepStrictEqual(uniqueTags, uniqueReleases)) {
    throw new Error(
      "ordinal Git tags must exactly match retained immutable releases",
    );
  }

  const existingOrdinals = [
    ...new Set(existingVersions.map((version) => parseOrdinalVersion(version))),
  ];
  const nextOrdinal = Math.max(0, ...existingOrdinals) + 1;
  for (let expected = 1; expected < nextOrdinal; expected += 1) {
    if (!existingOrdinals.includes(expected)) {
      throw new Error(`ordinal history is not contiguous: missing v${expected}`);
    }
  }

  if (input.sourceSha !== input.currentMainSha) {
    throw new Error("captured source SHA is not current main");
  }
  if (ordinal !== nextOrdinal) {
    throw new Error(
      `requested ${input.requestedVersion}, but the next release is v${nextOrdinal}`,
    );
  }

  return {
    ordinal,
    sourceSha: input.sourceSha,
    version: input.requestedVersion,
  };
}

async function createManifest(input) {
  input = parseSchema(releaseManifestInputSchema, input, "release manifest input");
  const backend = await readImageResult(
    input.images.backend,
    backendImageName,
    input.sourceSha,
  );
  const web = await readImageResult(
    input.images.web,
    webImageName,
    input.sourceSha,
  );
  if (
    !isDeepStrictEqual(
      backend.vulnerabilityWaiver,
      web.vulnerabilityWaiver,
    )
  ) {
    throw new Error("image vulnerability waivers do not match");
  }

  return parseSchema(
    releaseManifestSchema,
    {
      schemaVersion: "inside.platform.release-manifest.v1",
      version: input.version,
      source: {
        repository: input.repository,
        sha: input.sourceSha,
      },
      images: {
        backend: `${backend.image.name}@${backend.image.digest}`,
        web: `${web.image.name}@${web.image.digest}`,
      },
      vulnerabilityWaiver: backend.vulnerabilityWaiver,
    },
    "release manifest",
  );
}

async function readImageResult(path, imageName, sourceSha) {
  const image = parseSchema(
    releaseImageResultSchema,
    await readJson(path, `${imageName} result`),
    `${imageName} result`,
  );
  if (image.image.name !== imageName || image.sourceSha !== sourceSha) {
    throw new Error(`${imageName} result does not bind the release source`);
  }
  return image;
}

async function readJson(path, label) {
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch {
    throw new Error(`${label} is missing`);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
}

function parseOrdinalVersion(version) {
  version = parseSchema(ordinalVersionSchema, version, "release version");
  return Number(version.slice(1));
}
