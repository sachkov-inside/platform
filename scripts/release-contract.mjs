#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";

import {
  backendImageName,
  ordinalVersionSchema,
  parseSchema,
  productionRuntimeBundleAssetName,
  releaseAssetNames,
  releaseImageMatrix,
  releaseImageResultSchema,
  releaseManifestAssetName,
  releaseManifestInputSchema,
  releaseManifestSchema,
  releasePlanInputSchema,
  webImageName,
} from "../release/contract-schema.mjs";

const [command, inputFlag, inputPath] = process.argv.slice(2);

try {
  if (command === "images") {
    if (inputFlag || inputPath) {
      throw new Error("usage: release-contract.mjs images");
    }
    writeResult(releaseImageMatrix);
    process.exit(0);
  }

  if (inputFlag !== "--input" || !inputPath) {
    throw new Error("usage: release-contract.mjs <command> --input <path>");
  }

  const input = JSON.parse(
    inputPath === "-" ? await readStandardInput() : await readFile(inputPath, "utf8"),
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

async function readStandardInput() {
  process.stdin.setEncoding("utf8");
  let text = "";
  for await (const chunk of process.stdin) {
    text += chunk;
  }
  return text;
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
    imageMatrix: releaseImageMatrix,
    manifestAssetName: releaseManifestAssetName,
    ordinal,
    previousVersion: ordinal === 1 ? null : `v${String(ordinal - 1)}`,
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
  const previous = await createPreviousProof(input);
  return parseSchema(
    releaseManifestSchema,
    {
      schemaVersion: "inside.platform.release-manifest.v2",
      version: input.version,
      source: {
        repository: input.repository,
        sha: input.sourceSha,
      },
      images: {
        backend: `${backend.image.name}@${backend.image.digest}`,
        web: `${web.image.name}@${web.image.digest}`,
      },
      schema: {
        identity: input.schemaIdentity,
      },
      runtimeBundle: {
        asset: productionRuntimeBundleAssetName,
        sha256: await sha256File(input.runtimeBundle, "production runtime bundle"),
      },
      publication: {
        workflowRunId: input.publicationWorkflowRunId,
      },
      rollback: { previous },
    },
    "release manifest",
  );
}

async function createPreviousProof(input) {
  const ordinal = parseOrdinalVersion(input.version);
  if (input.rollback.previous === null) {
    if (ordinal !== 1) {
      throw new Error(`${input.version} must bind the exact previous release`);
    }
    return null;
  }
  if (ordinal === 1) {
    throw new Error("v1 cannot declare a previous release");
  }

  const previousText = await readText(
    input.rollback.previous.manifest,
    "previous release manifest",
  );
  const previous = parseSchema(
    releaseManifestSchema,
    parseJson(previousText, "previous release manifest"),
    "previous release manifest",
  );
  if (parseOrdinalVersion(previous.version) !== ordinal - 1) {
    throw new Error(
      `${input.version} must follow ${previous.version} without an ordinal gap`,
    );
  }
  if (input.rollback.previous.schemaIdentity !== previous.schema.identity) {
    throw new Error("previous backend image does not match its manifest schema identity");
  }
  return {
    version: previous.version,
    sourceSha: previous.source.sha,
    manifestSha256: sha256(previousText),
    schemaIdentity: previous.schema.identity,
    compatible: input.schemaIdentity === previous.schema.identity,
    verifiedByWorkflowRunId: input.publicationWorkflowRunId,
  };
}

async function sha256File(path, label) {
  return sha256(await readBytes(path, label));
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
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
  return parseJson(await readText(path, label), label);
}

async function readText(path, label) {
  return readFile(path, "utf8").catch(() => {
    throw new Error(`${label} is missing`);
  });
}

async function readBytes(path, label) {
  return readFile(path).catch(() => {
    throw new Error(`${label} is missing`);
  });
}

function parseJson(text, label) {
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
