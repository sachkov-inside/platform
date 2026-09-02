#!/usr/bin/env node

import { createHash } from "node:crypto";
import { globSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";

import {
  attestationSchema,
  attestationVerificationSchema,
  backendImageName,
  identityInputsSchema,
  imageIdentitySchema,
  normalizedEvidenceSchema,
  ordinalVersionSchema,
  parseSchema,
  releaseAssetInputSchema,
  releaseAssetNames,
  releaseEvidenceInputSchema,
  releaseManifestInputSchema,
  releaseManifestSchema,
  releasePlanInputSchema,
  sigstoreBundleSchema,
  spdxDocumentSchema,
  vulnerabilityReportSchema,
  waiverSchema,
  webImageName,
  workflowIdentitySchema,
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
    process.stdout.write(`${JSON.stringify(planRelease(input), null, 2)}\n`);
  } else if (command === "evidence") {
    process.stdout.write(
      `${JSON.stringify(await normalizeEvidence(input), null, 2)}\n`,
    );
  } else if (command === "manifest") {
    process.stdout.write(
      `${JSON.stringify(await createManifest(input), null, 2)}\n`,
    );
  } else if (command === "assets") {
    process.stdout.write(
      `${JSON.stringify(await verifyEvidenceAssets(input), null, 2)}\n`,
    );
  } else {
    throw new Error(`unknown release contract command: ${command ?? ""}`);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : "release contract failed";
  process.stderr.write(`release contract: ${message}\n`);
  process.exitCode = 1;
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

async function normalizeEvidence(input) {
  input = parseSchema(releaseEvidenceInputSchema, input, "release evidence");
  const image = assertImage(input.image);

  const sbom = await readJson(input.sbomPath, "SBOM");
  const vulnerabilities = await readJson(
    input.vulnerabilityPath,
    "vulnerability report",
  );
  const provenanceBundle = await readJson(
    input.provenanceBundlePath,
    "provenance bundle",
  );
  const provenanceVerification = await readJson(
    input.provenanceVerificationPath,
    "provenance verification",
  );
  const sbomBundle = await readJson(input.sbomBundlePath, "SBOM bundle");
  const sbomVerification = await readJson(
    input.sbomVerificationPath,
    "SBOM verification",
  );

  assertSpdx(sbom.value);
  assertSigstoreBundle(provenanceBundle.value, "provenance bundle");
  assertSigstoreBundle(sbomBundle.value, "SBOM bundle");
  assertVerification(
    provenanceVerification.value,
    image,
    "https://slsa.dev/provenance/v1",
  );
  const verifiedSbom = assertVerification(
    sbomVerification.value,
    image,
    "https://spdx.dev/Document/v2.3",
  );
  if (!isDeepStrictEqual(verifiedSbom.predicate, sbom.value)) {
    throw new Error("SBOM does not describe the exact image digest");
  }

  const vulnerabilityReport = parseSchema(
    vulnerabilityReportSchema,
    vulnerabilities.value,
    "vulnerability report",
  );
  const severities = vulnerabilityReport.matches.map(
    (match) => match?.vulnerability?.severity,
  );
  const high = severities.filter((severity) => severity === "High").length;
  const critical = severities.filter((severity) => severity === "Critical").length;
  const hasBlockingFindings = high > 0 || critical > 0;

  if (hasBlockingFindings && input.waiver === null) {
    throw new Error(
      `${high} high and ${critical} critical vulnerabilities require an owner waiver`,
    );
  }
  const waiver = hasBlockingFindings ? assertWaiver(input.waiver) : null;

  return parseSchema(
    normalizedEvidenceSchema,
    {
      image,
      sourceSha: input.sourceSha,
      sbom: {
        attestation: assertAttestation(input.sbomAttestation, "SBOM attestation"),
        bundleSha256: sha256(sbomBundle.text),
        documentSha256: sha256(sbom.text),
      },
      provenance: {
        attestation: assertAttestation(
          input.provenanceAttestation,
          "provenance attestation",
        ),
        bundleSha256: sha256(provenanceBundle.text),
      },
      vulnerabilities: {
        critical,
        decision: hasBlockingFindings ? "waived" : "passed",
        high,
        reportSha256: sha256(vulnerabilities.text),
        waiver,
      },
    },
    "normalized evidence",
  );
}

async function readJson(path, label) {
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch {
    throw new Error(`${label} is missing`);
  }

  try {
    return { text, value: JSON.parse(text) };
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
}

function assertImage(image) {
  return parseSchema(imageIdentitySchema, image, "image identity");
}

function assertSpdx(sbom) {
  parseSchema(spdxDocumentSchema, sbom, "SBOM");
}

function assertSigstoreBundle(bundle, label) {
  parseSchema(sigstoreBundleSchema, bundle, label);
}

function assertVerification(verification, image, predicateType) {
  verification = parseSchema(
    attestationVerificationSchema,
    verification,
    `verified ${predicateType} attestation`,
  );

  const statement = verification[0].verificationResult.statement;
  const subject = statement.subject.find(
    (candidate) => candidate.name === image.name,
  );
  if (
    statement?.predicateType !== predicateType ||
    subject?.digest.sha256 !== image.digest.slice("sha256:".length)
  ) {
    throw new Error(`verified ${predicateType} attestation has the wrong subject`);
  }

  return statement;
}

function assertAttestation(attestation, label) {
  return parseSchema(attestationSchema, attestation, label);
}

function assertWaiver(waiver) {
  return parseSchema(waiverSchema, waiver, "owner waiver");
}

function sha256(text) {
  return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}

async function createManifest(input) {
  input = parseSchema(releaseManifestInputSchema, input, "release manifest input");
  const workflow = assertWorkflow(input.workflow);
  const identityInputs = (
    await readJson(input.identityInputsPath, "identity inputs")
  ).value;
  parseSchema(identityInputsSchema, identityInputs, "identity inputs");
  const backend = assertNormalizedEvidence(
    (await readJson(input.images?.backend, "backend evidence")).value,
    backendImageName,
    input.sourceSha,
  );
  const web = assertNormalizedEvidence(
    (await readJson(input.images?.web, "web evidence")).value,
    webImageName,
    input.sourceSha,
  );

  const manifest = {
    schemaVersion: "inside.platform.release-manifest.v1",
    version: input.version,
    source: {
      repository: input.repository,
      sha: input.sourceSha,
    },
    workflow,
    identities: {
      migrations: await treeIdentity(identityInputs.migrations, "migrations"),
      configuration: await treeIdentity(
        identityInputs.configuration,
        "configuration",
      ),
    },
    images: {
      backend: withAssetNames("backend", backend),
      web: withAssetNames("web", web),
    },
  };
  return parseSchema(releaseManifestSchema, manifest, "release manifest");
}

function parseOrdinalVersion(version) {
  version = parseSchema(ordinalVersionSchema, version, "release version");
  const ordinal = Number(version.slice(1));
  return ordinal;
}

function assertWorkflow(workflow) {
  return parseSchema(workflowIdentitySchema, workflow, "workflow identity");
}

function assertNormalizedEvidence(evidence, imageName, sourceSha) {
  evidence = parseSchema(
    normalizedEvidenceSchema,
    evidence,
    `${imageName} evidence`,
  );
  if (evidence.image.name !== imageName || evidence.sourceSha !== sourceSha) {
    throw new Error(`${imageName} evidence does not bind the release source`);
  }
  return evidence;
}

async function verifyEvidenceAssets(input) {
  input = parseSchema(releaseAssetInputSchema, input, "release evidence assets");
  const evidence = parseSchema(
    normalizedEvidenceSchema,
    (await readJson(input.evidencePath, "normalized evidence")).value,
    "normalized evidence",
  );
  const assets = [
    [
      input.provenanceBundlePath,
      evidence.provenance.bundleSha256,
      "provenance bundle",
    ],
    [input.sbomBundlePath, evidence.sbom.bundleSha256, "SBOM bundle"],
    [input.sbomPath, evidence.sbom.documentSha256, "SBOM document"],
    [
      input.vulnerabilityPath,
      evidence.vulnerabilities.reportSha256,
      "vulnerability report",
    ],
  ];
  for (const [path, expectedDigest, label] of assets) {
    const asset = await readJson(path, label);
    if (sha256(asset.text) !== expectedDigest) {
      throw new Error(`${label} does not match normalized evidence`);
    }
  }
  return evidence;
}

async function treeIdentity(patterns, label) {
  const files = [];
  for (const pattern of patterns) {
    const matches = globSync(pattern, {
      cwd: process.cwd(),
      nodir: true,
    }).sort();
    if (matches.length === 0) {
      throw new Error(`${label} identity pattern matched no files: ${pattern}`);
    }
    files.push(...matches);
  }

  const uniqueFiles = [...new Set(files)].sort();
  const hash = createHash("sha256");
  for (const path of uniqueFiles) {
    const contents = await readFile(path);
    hash.update(`${path}\0${contents.byteLength}\0`);
    hash.update(contents);
    hash.update("\0");
  }

  return {
    digest: `sha256:${hash.digest("hex")}`,
    files: uniqueFiles,
  };
}

function withAssetNames(kind, evidence) {
  const { sourceSha: _sourceSha, ...releasedEvidence } = evidence;
  return {
    ...releasedEvidence,
    provenance: {
      ...releasedEvidence.provenance,
      attestation: { url: releasedEvidence.provenance.attestation.url },
    },
    sbom: {
      ...releasedEvidence.sbom,
      attestation: { url: releasedEvidence.sbom.attestation.url },
    },
    assets: {
      provenanceBundle: `${kind}.provenance.bundle.json`,
      sbomBundle: `${kind}.sbom.bundle.json`,
      sbomDocument: `${kind}.sbom.spdx.json`,
      vulnerabilityReport: `${kind}.vulnerabilities.json`,
    },
  };
}
