// @ts-check
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { selectReleaseEvidence } from "./release-source-evidence.mjs";
import { applicationCoverage, ciJobNames } from "./ci-coverage-plan.mjs";
import {
  releaseManifestSchema,
  sourceShaSchema,
  sha256DigestSchema,
} from "../release/contract-schema.mjs";

const checkNames = [
  "check",
  "check:full",
  "compose-smoke-shutdown",
  "standards",
  "spec",
  "ci",
  "fullstack",
  "telemetry-resource-budget",
];
const coverageNames = [
  "check",
  "integration",
  "enrollment",
  "buyer-journey",
  "compose-smoke-shutdown",
  "standards",
  "spec",
  "ci",
  "fullstack",
  "telemetry-resource-budget",
];
const excludedTelemetrySchema = z.strictObject({
  name: z.literal("telemetry-resource-budget"),
  sourceSha: sourceShaSchema,
  exitCode: z.null(),
  outcome: z.literal("owner-excluded"),
  authorizationRef: z.literal("owner-2026-10-13-1408-v36"),
  evidenceRef: z.string().min(1),
});
const legacyEvidenceSchema = z.strictObject({
  schemaVersion: z.literal("inside.course-release-preflight.v1"),
  checks: z.array(
    z.union([
      z.strictObject({
        name: z.enum(checkNames),
        sourceSha: sourceShaSchema,
        exitCode: z.int(),
        evidenceRef: z.string().min(1),
      }),
      excludedTelemetrySchema,
    ]),
  ),
  publication: z.strictObject({
    sourceSha: sourceShaSchema,
    workflowRunId: z.int().positive(),
    immutable: z.literal(true),
    succeeded: z.literal(true),
  }),
  backup: z.strictObject({
    label: z.string().min(1),
    finishedAt: z.iso.datetime(),
    checkExitCode: z.literal(0),
  }),
  restore: z.strictObject({
    backupLabel: z.string().min(1),
    finishedAt: z.iso.datetime(),
    exitCode: z.literal(0),
    volume: z
      .string()
      .startsWith("inside-production-postgres-data-recovery-check-"),
    networkMode: z.literal("none"),
    publishedPorts: z.literal(0),
    databasesPassed: z.array(z.enum(["inside", "logto", "inside_telegram"])),
  }),
});
const coverageReceiptSchema = z.strictObject({
  name: z.enum(coverageNames),
  sourceSha: sourceShaSchema,
  exitCode: z.int(),
  evidenceRef: z.string().min(1),
  execution: z.discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("ci"),
      workflowRunId: z.int().positive(),
      job: z.string().min(1),
      conclusion: z.literal("success"),
    }),
    z.strictObject({ kind: z.literal("local") }),
    z.strictObject({ kind: z.literal("review") }),
  ]),
});
const coverageEvidenceSchema = legacyEvidenceSchema.extend({
  schemaVersion: z.literal("inside.course-release-preflight.v2"),
  selectedSourceSha: sourceShaSchema,
  checks: z.array(z.union([coverageReceiptSchema, excludedTelemetrySchema])),
});
const activeCoverageNames = coverageNames.filter(
  (name) => name !== "telemetry-resource-budget",
);
const evidenceSchema = z.union([
  legacyEvidenceSchema,
  coverageEvidenceSchema,
  coverageEvidenceSchema.extend({
    schemaVersion: z.literal("inside.course-release-preflight.v3"),
    sourceCorrespondence: z
      .strictObject({ candidates: z.array(z.unknown()) })
      .optional(),
    checks: z.array(
      coverageReceiptSchema.extend({ name: z.enum(activeCoverageNames) }),
    ),
  }),
]);
const inputSchema = z.strictObject({
  currentMainSha: sourceShaSchema,
  selectedSourceTreeSha: sourceShaSchema.optional(),
  manifest: releaseManifestSchema,
  previousManifest: releaseManifestSchema.nullable(),
  previousManifestDigest: sha256DigestSchema.nullable(),
  bundleDigest: sha256DigestSchema,
  imageDigests: z.strictObject({
    backend: z.array(z.string()),
    web: z.array(z.string()),
  }),
  evidence: evidenceSchema,
});
const backupMaxAgeMilliseconds = 8 * 60 * 60 * 1_000;
/** @type {readonly ["backend", "web"]} */
const imageKinds = ["backend", "web"];

/** CI jobs proving each operator coverage receipt. Reviews always bind the selected commit.
 * @type {Record<string, string[]>}
 */
const receiptCoverage = {
  check: ["static", "unit", "ui", "web-e2e"],
  integration: ["integration", "integration-serial"],
  enrollment: ["integration"],
  "buyer-journey": ["integration"],
  "compose-smoke-shutdown": ["compose-development", "compose-production"],
  ci: applicationCoverage.platform,
  fullstack: ["fullstack"],
};

/** Release evidence gate; host deploy preflight remains authoritative for live state.
 * @param {unknown} value
 * @param {Date} now
 */
export function assessCourseRelease(value, now) {
  const parsed = inputSchema.safeParse(value);
  if (!parsed.success) throw new Error("invalid preflight evidence");
  const input = parsed.data;
  const { manifest, evidence } = input;
  const selectedSourceSha =
    evidence.schemaVersion !== "inside.course-release-preflight.v1"
      ? evidence.selectedSourceSha
      : input.currentMainSha;
  if (manifest.source.sha !== selectedSourceSha)
    throw new Error("release source does not match selected source");
  let telemetryExcluded = false;
  const requiredChecks =
    evidence.schemaVersion === "inside.course-release-preflight.v3"
      ? activeCoverageNames
      : evidence.schemaVersion === "inside.course-release-preflight.v2"
        ? coverageNames
        : checkNames;
  for (const name of requiredChecks) {
    const receipts = evidence.checks.filter((check) => check.name === name);
    const receipt = receipts[0];
    const ownerExcluded =
      name === "telemetry-resource-budget" &&
      manifest.version === "v36" &&
      receipt?.exitCode === null;
    let sourceMatches = receipt?.sourceSha === manifest.source.sha;
    const executedReceipt = coverageReceiptSchema.safeParse(receipt);
    if (
      !sourceMatches &&
      executedReceipt.success &&
      executedReceipt.data.execution.kind === "ci" &&
      evidence.schemaVersion === "inside.course-release-preflight.v3" &&
      evidence.sourceCorrespondence !== undefined &&
      input.selectedSourceTreeSha !== undefined
    ) {
      const requiredCoverage = receiptCoverage[name];
      if (requiredCoverage !== undefined) {
        const proof = selectReleaseEvidence({
          repository: manifest.source.repository,
          sourceSha: manifest.source.sha,
          treeSha: input.selectedSourceTreeSha,
          requiredCoverage,
          candidates: evidence.sourceCorrespondence.candidates,
        });
        const workflowRunId = executedReceipt.data.execution.workflowRunId;
        const actualJob = executedReceipt.data.execution.job;
        const applicableJobs =
          name === "ci"
            ? [ciJobNames["ci-gate"]]
            : requiredCoverage.map((id) => ciJobNames[id]);
        sourceMatches =
          applicableJobs.includes(actualJob) &&
          proof.evidenceRuns.some(
            (run) =>
              run.runId === workflowRunId &&
              run.sourceSha === executedReceipt.data.sourceSha &&
              run.providerJobs.some((job) => job.name === actualJob) &&
              requiredCoverage.every((job) => run.coverage.includes(job)),
          );
      }
    }
    if (
      receipts.length !== 1 ||
      !sourceMatches ||
      (receipt?.exitCode !== 0 && !ownerExcluded)
    )
      throw new Error("missing, failed or stale check evidence");
    if (ownerExcluded) telemetryExcluded = true;
  }
  if (
    evidence.publication.sourceSha !== manifest.source.sha ||
    evidence.publication.workflowRunId !== manifest.publication.workflowRunId
  )
    throw new Error("publication evidence does not bind this manifest");
  if (input.bundleDigest !== manifest.runtimeBundle.sha256)
    throw new Error("runtime bundle digest mismatch");
  for (const kind of imageKinds) {
    if (!input.imageDigests[kind].includes(manifest.images[kind]))
      throw new Error("local image digest mismatch");
  }
  const previous = manifest.rollback.previous;
  if (previous === null) {
    if (
      manifest.version !== "v1" ||
      input.previousManifest !== null ||
      input.previousManifestDigest !== null
    )
      throw new Error("missing previous manifest binding");
  } else {
    const bound = input.previousManifest;
    if (
      bound === null ||
      input.previousManifestDigest !== previous.manifestSha256 ||
      bound.version !== previous.version ||
      bound.source.sha !== previous.sourceSha ||
      bound.schema.identity !== previous.schemaIdentity ||
      Number(manifest.version.slice(1)) !==
        Number(bound.version.slice(1)) + 1 ||
      previous.verifiedByWorkflowRunId !== manifest.publication.workflowRunId ||
      previous.compatible !==
        (manifest.schema.identity === bound.schema.identity)
    )
      throw new Error("previous manifest or schema binding mismatch");
  }
  const backupAt = Date.parse(evidence.backup.finishedAt);
  const restoreAt = Date.parse(evidence.restore.finishedAt);
  const age = now.getTime() - backupAt;
  if (!Number.isFinite(age) || age < 0 || age > backupMaxAgeMilliseconds)
    throw new Error("backup freshness exceeds eight hours");
  if (
    evidence.restore.backupLabel !== evidence.backup.label ||
    restoreAt < backupAt ||
    restoreAt > now.getTime() ||
    new Set(evidence.restore.databasesPassed).size !== 3
  )
    throw new Error("restore evidence does not prove this backup");
  return {
    version: manifest.version,
    sourceSha: manifest.source.sha,
    rollback:
      previous?.compatible === true
        ? "eligible-after-host-preflight"
        : "repair-forward",
    backupLabel: evidence.backup.label,
    ...(telemetryExcluded ? { telemetryResourceBudget: "owner-excluded" } : {}),
  };
}

/** @param {Buffer} bytes */
function digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}
/** @param {string} file @returns {unknown} */
function jsonFile(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function main() {
  const [evidenceFile, manifestFile, bundleFile, previousFile] =
    process.argv.slice(2);
  if (!evidenceFile || !manifestFile || !bundleFile || process.argv.length > 6)
    throw new Error(
      "usage: course-release-preflight.mjs <evidence.json> <manifest.json> <runtime.tar.gz> [previous-manifest.json]",
    );
  const manifest = releaseManifestSchema.parse(jsonFile(manifestFile));
  const imageDigests = Object.fromEntries(
    ["backend", "web"].map((kind) => {
      const reference =
        kind === "backend" ? manifest.images.backend : manifest.images.web;
      /** @type {unknown} */
      const values = JSON.parse(
        execFileSync(
          "docker",
          ["image", "inspect", reference, "--format", "{{json .RepoDigests}}"],
          { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        ),
      );
      return [kind, z.array(z.string()).parse(values)];
    }),
  );
  const result = assessCourseRelease(
    {
      manifest,
      selectedSourceTreeSha: execFileSync(
        "git",
        ["rev-parse", `${manifest.source.sha}^{tree}`],
        { encoding: "utf8" },
      ).trim(),
      evidence: jsonFile(evidenceFile),
      currentMainSha: execFileSync("git", ["rev-parse", "origin/main"], {
        encoding: "utf8",
      }).trim(),
      previousManifest: previousFile ? jsonFile(previousFile) : null,
      previousManifestDigest: previousFile
        ? digest(readFileSync(previousFile))
        : null,
      bundleDigest: digest(readFileSync(bundleFile)),
      imageDigests,
    },
    new Date(),
  );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    main();
  } catch {
    // Never echo unknown JSON, command stderr, configuration values or secret paths.
    process.stderr.write(
      "course release preflight failed; check evidence, exact assets and local image digests\n",
    );
    process.exitCode = 1;
  }
}
