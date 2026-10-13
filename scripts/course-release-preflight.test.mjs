// @ts-check
import assert from "node:assert/strict";
import { test } from "node:test";
import { assessCourseRelease } from "./course-release-preflight.mjs";

const now = new Date("2026-10-11T12:00:00Z");
const sha = "a".repeat(40);
const digest = `sha256:${"b".repeat(64)}`;

function fixture() {
  return {
    currentMainSha: sha,
    manifest: {
      schemaVersion: "inside.platform.release-manifest.v2",
      version: "v1",
      source: { repository: "sachkov-inside/platform", sha },
      images: {
        backend: `ghcr.io/sachkov-inside/platform-backend@${digest}`,
        web: `ghcr.io/sachkov-inside/platform-web@${digest}`,
      },
      schema: { identity: digest },
      runtimeBundle: { asset: "production-runtime.tar.gz", sha256: digest },
      publication: { workflowRunId: 854 },
      rollback: { previous: null },
    },
    previousManifest: null,
    previousManifestDigest: null,
    bundleDigest: digest,
    imageDigests: {
      backend: [`ghcr.io/sachkov-inside/platform-backend@${digest}`],
      web: [`ghcr.io/sachkov-inside/platform-web@${digest}`],
    },
    evidence: {
      schemaVersion: "inside.course-release-preflight.v1",
      checks: [
        "check",
        "check:full",
        "compose-smoke-shutdown",
        "standards",
        "spec",
        "ci",
        "fullstack",
        "telemetry-resource-budget",
      ].map((name) => ({
        name,
        sourceSha: sha,
        exitCode: 0,
        evidenceRef: `evidence/${name}.log`,
      })),
      publication: {
        sourceSha: sha,
        workflowRunId: 854,
        immutable: true,
        succeeded: true,
      },
      backup: {
        label: "20261011-100000F",
        finishedAt: "2026-10-11T10:05:00Z",
        checkExitCode: 0,
      },
      restore: {
        backupLabel: "20261011-100000F",
        finishedAt: "2026-10-11T11:00:00Z",
        exitCode: 0,
        volume: "inside-production-postgres-data-recovery-check-854",
        networkMode: "none",
        publishedPorts: 0,
        databasesPassed: ["inside", "logto", "inside_telegram"],
      },
    },
  };
}

test("preflight binds checks, digests and isolated recovery to one release", () => {
  assert.deepEqual(assessCourseRelease(fixture(), now), {
    version: "v1",
    sourceSha: sha,
    rollback: "repair-forward",
    backupLabel: "20261011-100000F",
  });
});

test("preflight refuses checks from another SHA and a failed Compose shutdown", () => {
  const input = fixture();
  const check = input.evidence.checks.find(
    (receipt) => receipt.name === "check",
  );
  const compose = input.evidence.checks.find(
    (receipt) => receipt.name === "compose-smoke-shutdown",
  );
  assert.ok(check && compose);
  check.sourceSha = "c".repeat(40);
  assert.throws(() => assessCourseRelease(input, now), /check evidence/u);
  check.sourceSha = sha;
  compose.exitCode = 1;
  assert.throws(() => assessCourseRelease(input, now), /check evidence/u);
});

test("preflight requires the telemetry resource budget before a release", () => {
  const missing = fixture();
  missing.evidence.checks = missing.evidence.checks.filter(
    (receipt) => receipt.name !== "telemetry-resource-budget",
  );
  assert.throws(() => assessCourseRelease(missing, now), /check evidence/u);
  const failed = fixture();
  const budget = failed.evidence.checks.find(
    (receipt) => receipt.name === "telemetry-resource-budget",
  );
  assert.ok(budget);
  budget.exitCode = 1;
  assert.throws(() => assessCourseRelease(failed, now), /check evidence/u);
  budget.exitCode = 0;
  budget.sourceSha = "c".repeat(40);
  assert.throws(() => assessCourseRelease(failed, now), /check evidence/u);
});

test("preflight admits only the explicit owner-excluded telemetry receipt for v36", () => {
  const first = fixture();
  const previous = { ...first.manifest, version: "v35" };
  const previousDigest = `sha256:${"e".repeat(64)}`;
  const input = {
    ...first,
    previousManifest: previous,
    previousManifestDigest: previousDigest,
    manifest: {
      ...first.manifest,
      version: "v36",
      rollback: {
        previous: {
          version: "v35",
          sourceSha: sha,
          manifestSha256: previousDigest,
          schemaIdentity: digest,
          compatible: true,
          verifiedByWorkflowRunId: 854,
        },
      },
    },
    evidence: {
      ...first.evidence,
      checks: [
        ...first.evidence.checks.filter(
          (receipt) => receipt.name !== "telemetry-resource-budget",
        ),
        {
          name: "telemetry-resource-budget",
          sourceSha: sha,
          exitCode: null,
          outcome: "owner-excluded",
          authorizationRef: "owner-2026-10-13-1408-v36",
          evidenceRef: "evidence/owner-excluded.json",
        },
      ],
    },
  };
  const result = assessCourseRelease(input, now);
  assert.equal(result.version, "v36");
  assert.equal(result.telemetryResourceBudget, "owner-excluded");

  const excluded = input.evidence.checks.at(-1);
  assert.ok(excluded);
  excluded.sourceSha = "c".repeat(40);
  assert.throws(() => assessCourseRelease(input, now), /check evidence/u);
  excluded.sourceSha = sha;
  assert.ok("authorizationRef" in excluded);
  excluded.authorizationRef = "unapproved";
  assert.throws(
    () => assessCourseRelease(input, now),
    /invalid preflight evidence/u,
  );
  excluded.authorizationRef = "owner-2026-10-13-1408-v36";
  input.manifest.version = "v37";
  assert.throws(() => assessCourseRelease(input, now), /check evidence/u);
  input.manifest.version = "v36";
  const functional = input.evidence.checks.find(
    (receipt) => receipt.name === "check:full",
  );
  assert.ok(functional);
  functional.exitCode = 1;
  assert.throws(() => assessCourseRelease(input, now), /check evidence/u);
});

test("preflight rejects stale backup, a different backup restore and production network access", () => {
  const stale = fixture();
  stale.evidence.backup.finishedAt = "2026-10-10T10:05:00Z";
  assert.throws(() => assessCourseRelease(stale, now), /backup freshness/u);
  const mismatch = fixture();
  mismatch.evidence.restore.backupLabel = "20261010-100000F";
  assert.throws(() => assessCourseRelease(mismatch, now), /restore evidence/u);
  const connected = fixture();
  connected.evidence.restore.networkMode = "host";
  assert.throws(
    () => assessCourseRelease(connected, now),
    /invalid preflight evidence/u,
  );
});

test("preflight rejects changed assets and mutable image selection", () => {
  const bundle = fixture();
  bundle.bundleDigest = `sha256:${"d".repeat(64)}`;
  assert.throws(() => assessCourseRelease(bundle, now), /bundle digest/u);
  const image = fixture();
  image.imageDigests.backend = [
    "ghcr.io/sachkov-inside/platform-backend:latest",
  ];
  assert.throws(() => assessCourseRelease(image, now), /image digest/u);
});

test("new schema requires repair forward and cannot forge previous compatibility", () => {
  const first = fixture();
  const previous = first.manifest;
  const previousDigest = `sha256:${"e".repeat(64)}`;
  const input = {
    ...first,
    previousManifest: previous,
    previousManifestDigest: previousDigest,
    manifest: {
      ...first.manifest,
      version: "v2",
      schema: { identity: `sha256:${"f".repeat(64)}` },
      rollback: {
        previous: {
          version: "v1",
          sourceSha: sha,
          manifestSha256: previousDigest,
          schemaIdentity: digest,
          compatible: false,
          verifiedByWorkflowRunId: 854,
        },
      },
    },
  };
  assert.equal(assessCourseRelease(input, now).rollback, "repair-forward");
  input.manifest.rollback.previous.compatible = true;
  assert.throws(() => assessCourseRelease(input, now), /schema binding/u);
});

function ciFixture() {
  const input = fixture();
  const names = [
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
  return {
    ...input,
    evidence: {
      ...input.evidence,
      schemaVersion: "inside.course-release-preflight.v2",
      checks: names.map((name) => ({
        name,
        sourceSha: sha,
        exitCode: 0,
        evidenceRef: `evidence/${name}.json`,
        execution: {
          kind: "ci",
          workflowRunId: 123,
          job: name,
          conclusion: "success",
        },
      })),
    },
  };
}

test("v2 reuses exact-source CI coverage without duplicate local aggregate receipts", () => {
  assert.equal(assessCourseRelease(ciFixture(), now).sourceSha, sha);
});

test("v2 rejects missing coverage, failed cleanup and synthetic source evidence", () => {
  for (const name of [
    "integration",
    "enrollment",
    "buyer-journey",
    "fullstack",
  ]) {
    const input = ciFixture();
    input.evidence.checks = input.evidence.checks.filter(
      (check) => check.name !== name,
    );
    assert.throws(() => assessCourseRelease(input, now), /check evidence/u);
  }
  const failed = ciFixture();
  const cleanup = failed.evidence.checks.find(
    (check) => check.name === "compose-smoke-shutdown",
  );
  assert.ok(cleanup);
  cleanup.exitCode = 1;
  assert.throws(() => assessCourseRelease(failed, now), /check evidence/u);
  const stale = ciFixture();
  const staleCheck = stale.evidence.checks[0];
  assert.ok(staleCheck);
  staleCheck.sourceSha = "c".repeat(40);
  assert.throws(() => assessCourseRelease(stale, now), /check evidence/u);
});

test("v2 requires CI run identity and successful conclusion", () => {
  const input = ciFixture();
  const invalid = {
    ...input.evidence.checks[0],
    execution: { kind: "ci", job: "static", conclusion: "success" },
  };
  assert.throws(
    () =>
      assessCourseRelease(
        {
          ...input,
          evidence: {
            ...input.evidence,
            checks: [invalid, ...input.evidence.checks.slice(1)],
          },
        },
        now,
      ),
    /invalid preflight evidence/u,
  );
  const failed = {
    ...invalid,
    execution: {
      kind: "ci",
      workflowRunId: 123,
      job: "static",
      conclusion: "failure",
    },
  };
  assert.throws(
    () =>
      assessCourseRelease(
        {
          ...input,
          evidence: {
            ...input.evidence,
            checks: [failed, ...input.evidence.checks.slice(1)],
          },
        },
        now,
      ),
    /invalid preflight evidence/u,
  );
});
