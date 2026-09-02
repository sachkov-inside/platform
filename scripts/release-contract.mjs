#!/usr/bin/env node

import { createHash } from "node:crypto";
import { globSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";

const [command, inputFlag, inputPath] = process.argv.slice(2);

try {
  if (inputFlag !== "--input" || !inputPath) {
    throw new Error("usage: release-contract.mjs <command> --input <path>");
  }

  const input = JSON.parse(await readFile(inputPath, "utf8"));

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
  } else {
    throw new Error(`unknown release contract command: ${command ?? ""}`);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : "release contract failed";
  process.stderr.write(`release contract: ${message}\n`);
  process.exitCode = 1;
}

function planRelease(input) {
  const ordinal = parseOrdinalVersion(input.requestedVersion);
  assertSourceSha(input.sourceSha);
  assertSourceSha(input.currentMainSha);
  if (!Array.isArray(input.existingVersions)) {
    throw new Error("existing release versions must be an array");
  }
  const existingOrdinals = [
    ...new Set(input.existingVersions.map((version) => parseOrdinalVersion(version))),
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
  const image = assertImage(input.image);
  assertSourceSha(input.sourceSha);

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
    input.sourceSha,
  );
  const verifiedSbom = assertVerification(
    sbomVerification.value,
    image,
    "https://spdx.dev/Document/v2.3",
  );
  if (!isDeepStrictEqual(verifiedSbom.predicate, sbom.value)) {
    throw new Error("SBOM does not describe the exact image digest");
  }

  if (!Array.isArray(vulnerabilities.value.matches)) {
    throw new Error("vulnerability report must contain matches");
  }
  const severities = vulnerabilities.value.matches.map(
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

  return {
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
  };
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
  assertExactKeys(image, ["digest", "name"], "image identity");
  if (
    typeof image?.name !== "string" ||
    !/^ghcr\.io\/[a-z0-9-]+\/[a-z0-9-]+$/u.test(image.name) ||
    typeof image.digest !== "string" ||
    !/^sha256:[a-f0-9]{64}$/u.test(image.digest)
  ) {
    throw new Error("image identity is invalid");
  }
  return { digest: image.digest, name: image.name };
}

function assertSourceSha(sourceSha) {
  if (typeof sourceSha !== "string" || !/^[a-f0-9]{40}$/u.test(sourceSha)) {
    throw new Error("source SHA must be a full lowercase Git commit SHA");
  }
}

function assertSpdx(sbom) {
  if (
    sbom?.spdxVersion !== "SPDX-2.3" ||
    sbom?.SPDXID !== "SPDXRef-DOCUMENT" ||
    !Array.isArray(sbom?.packages)
  ) {
    throw new Error("SBOM must be a complete SPDX 2.3 JSON document");
  }
}

function assertSigstoreBundle(bundle, label) {
  if (
    typeof bundle?.mediaType !== "string" ||
    typeof bundle?.verificationMaterial !== "object" ||
    typeof bundle?.dsseEnvelope !== "object"
  ) {
    throw new Error(`${label} is not a Sigstore bundle`);
  }
}

function assertVerification(verification, image, predicateType, sourceSha) {
  if (!Array.isArray(verification) || verification.length === 0) {
    throw new Error(`verified ${predicateType} attestation is missing`);
  }

  const statement = verification[0]?.verificationResult?.statement;
  const subject = statement?.subject?.find(
    (candidate) => candidate?.name === image.name,
  );
  if (
    statement?.predicateType !== predicateType ||
    subject?.digest?.sha256 !== image.digest.slice("sha256:".length)
  ) {
    throw new Error(`verified ${predicateType} attestation has the wrong subject`);
  }

  if (sourceSha) {
    const dependencies = statement.predicate?.buildDefinition?.resolvedDependencies;
    if (
      !Array.isArray(dependencies) ||
      !dependencies.some((dependency) => dependency?.digest?.gitCommit === sourceSha)
    ) {
      throw new Error("provenance does not bind the captured source SHA");
    }
  }
  return statement;
}

function assertAttestation(attestation, label) {
  assertExactKeys(attestation, ["id", "url"], label);
  if (
    typeof attestation?.id !== "string" ||
    !/^\d+$/u.test(attestation.id) ||
    attestation.url !==
      `https://github.com/sachkov-inside/platform/attestations/${attestation.id}`
  ) {
    throw new Error(`${label} identity is invalid`);
  }
  return { id: attestation.id, url: attestation.url };
}

function assertWaiver(waiver) {
  assertExactKeys(waiver, ["actor", "reason", "runUrl"], "owner waiver");
  if (
    typeof waiver?.actor !== "string" ||
    !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u.test(waiver.actor) ||
    typeof waiver.reason !== "string" ||
    waiver.reason.trim().length < 20 ||
    waiver.reason.length > 1000 ||
    typeof waiver.runUrl !== "string" ||
    !/^https:\/\/github\.com\/[^/]+\/[^/]+\/actions\/runs\/\d+$/u.test(
      waiver.runUrl,
    )
  ) {
    throw new Error("owner waiver must contain an actor, reason and workflow run URL");
  }
  return {
    actor: waiver.actor,
    reason: waiver.reason,
    runUrl: waiver.runUrl,
  };
}

function sha256(text) {
  return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}

async function createManifest(input) {
  const ordinal = parseOrdinalVersion(input.version);
  assertSourceSha(input.sourceSha);
  if (input.repository !== "sachkov-inside/platform") {
    throw new Error("release repository must be sachkov-inside/platform");
  }
  const workflow = assertWorkflow(input.workflow);
  const identityInputs = (
    await readJson(input.identityInputsPath, "identity inputs")
  ).value;
  assertExactKeys(
    identityInputs,
    ["configuration", "migrations"],
    "identity inputs",
  );
  const backend = (
    await readJson(input.images?.backend, "backend evidence")
  ).value;
  const web = (await readJson(input.images?.web, "web evidence")).value;

  assertNormalizedEvidence(
    backend,
    "ghcr.io/sachkov-inside/platform-backend",
    input.sourceSha,
  );
  assertNormalizedEvidence(
    web,
    "ghcr.io/sachkov-inside/platform-web",
    input.sourceSha,
  );

  return {
    schemaVersion: "inside.platform.release-manifest.v1",
    version: input.version,
    ordinal,
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
}

function parseOrdinalVersion(version) {
  if (typeof version !== "string" || !/^v[1-9][0-9]*$/u.test(version)) {
    throw new Error("release version must be vN with a positive ordinal");
  }
  const ordinal = Number(version.slice(1));
  if (!Number.isSafeInteger(ordinal)) {
    throw new Error("release ordinal exceeds the supported range");
  }
  return ordinal;
}

function assertWorkflow(workflow) {
  assertExactKeys(workflow, ["actor", "runUrl"], "workflow identity");
  if (
    typeof workflow?.actor !== "string" ||
    workflow.actor.length === 0 ||
    typeof workflow.runUrl !== "string" ||
    !/^https:\/\/github\.com\/sachkov-inside\/platform\/actions\/runs\/\d+$/u.test(
      workflow.runUrl,
    )
  ) {
    throw new Error("workflow identity is invalid");
  }
  return { actor: workflow.actor, runUrl: workflow.runUrl };
}

function assertNormalizedEvidence(evidence, imageName, sourceSha) {
  const kind = imageName.endsWith("-backend") ? "backend" : "web";
  assertExactKeys(
    evidence,
    ["image", "provenance", "sbom", "sourceSha", "vulnerabilities"],
    `${kind} image evidence`,
  );
  assertExactKeys(evidence?.image, ["digest", "name"], `${kind} image identity`);
  assertExactKeys(
    evidence?.sbom,
    ["attestation", "bundleSha256", "documentSha256"],
    `${kind} SBOM evidence`,
  );
  assertExactKeys(
    evidence?.provenance,
    ["attestation", "bundleSha256"],
    `${kind} provenance evidence`,
  );
  assertExactKeys(
    evidence?.vulnerabilities,
    ["critical", "decision", "high", "reportSha256", "waiver"],
    `${kind} vulnerability evidence`,
  );
  assertImage(evidence.image);
  if (evidence.image.name !== imageName || evidence.sourceSha !== sourceSha) {
    throw new Error(`${imageName} evidence does not bind the release source`);
  }
  for (const [label, digest] of [
    ["SBOM document", evidence.sbom?.documentSha256],
    ["SBOM bundle", evidence.sbom?.bundleSha256],
    ["provenance bundle", evidence.provenance?.bundleSha256],
    ["vulnerability report", evidence.vulnerabilities?.reportSha256],
  ]) {
    if (typeof digest !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(digest)) {
      throw new Error(`${imageName} ${label} digest is invalid`);
    }
  }
  assertAttestation(evidence.sbom?.attestation, "SBOM attestation");
  assertAttestation(evidence.provenance?.attestation, "provenance attestation");

  const vulnerabilities = evidence.vulnerabilities;
  if (
    !Number.isInteger(vulnerabilities?.high) ||
    vulnerabilities.high < 0 ||
    !Number.isInteger(vulnerabilities?.critical) ||
    vulnerabilities.critical < 0
  ) {
    throw new Error(`${imageName} vulnerability counts are invalid`);
  }
  const hasFindings = vulnerabilities.high > 0 || vulnerabilities.critical > 0;
  if (
    (!hasFindings &&
      (vulnerabilities.decision !== "passed" || vulnerabilities.waiver !== null)) ||
    (hasFindings && vulnerabilities.decision !== "waived")
  ) {
    throw new Error(`${imageName} vulnerability decision is invalid`);
  }
  if (hasFindings) {
    assertWaiver(vulnerabilities.waiver);
  }
}

async function treeIdentity(patterns, label) {
  if (!Array.isArray(patterns) || patterns.length === 0) {
    throw new Error(`${label} identity must declare input patterns`);
  }

  const files = [];
  for (const pattern of patterns) {
    if (typeof pattern !== "string" || pattern.length === 0) {
      throw new Error(`${label} identity contains an invalid pattern`);
    }
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
  return {
    ...evidence,
    assets: {
      provenanceBundle: `${kind}.provenance.bundle.json`,
      sbomBundle: `${kind}.sbom.bundle.json`,
      sbomDocument: `${kind}.sbom.spdx.json`,
      vulnerabilityReport: `${kind}.vulnerabilities.json`,
    },
  };
}

function assertExactKeys(value, allowedKeys, label) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const allowed = new Set(allowedKeys);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key)).sort();
  if (unknown.length > 0) {
    throw new Error(`${label} contains unknown fields: ${unknown.join(", ")}`);
  }
}
