// @ts-check
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { z } from "zod";
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
const evidenceSchema = z.strictObject({
  schemaVersion: z.literal("inside.course-release-preflight.v1"),
  checks: z.array(
    z.strictObject({
      name: z.enum(checkNames),
      sourceSha: sourceShaSchema,
      exitCode: z.int(),
      evidenceRef: z.string().min(1),
    }),
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
const inputSchema = z.strictObject({
  currentMainSha: sourceShaSchema,
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

/** Local evidence gate; host deploy preflight remains authoritative for live state.
 * @param {unknown} value
 * @param {Date} now
 */
export function assessCourseRelease(value, now) {
  const parsed = inputSchema.safeParse(value);
  if (!parsed.success) throw new Error("invalid preflight evidence");
  const input = parsed.data;
  const { manifest, evidence } = input;
  if (manifest.source.sha !== input.currentMainSha)
    throw new Error("release source is not current main");
  for (const name of checkNames) {
    const receipts = evidence.checks.filter((check) => check.name === name);
    if (
      receipts.length !== 1 ||
      receipts[0]?.sourceSha !== manifest.source.sha ||
      receipts[0]?.exitCode !== 0
    )
      throw new Error("missing, failed or stale check evidence");
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
