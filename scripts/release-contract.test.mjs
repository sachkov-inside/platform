import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { spawnSync } from "node:child_process";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("release contract CLI", () => {
  it("accepts the next ordinal release for the captured current main", () => {
    const result = runReleaseContract(
      "plan",
      "scripts/fixtures/release/plan-v3.json",
    );

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      ordinal: 3,
      sourceSha: "3333333333333333333333333333333333333333",
      version: "v3",
    });
  });

  it("rejects a duplicate ordinal release", () => {
    const result = runReleaseContract(
      "plan",
      "scripts/fixtures/release/plan-duplicate-v2.json",
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, /requested v2, but the next release is v3/u);
    assert.equal(result.stdout, "");
  });

  it("rejects a release after main moved beyond the captured SHA", () => {
    const result = runReleaseContract(
      "plan",
      "scripts/fixtures/release/plan-stale-main.json",
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, /captured source SHA is not current main/u);
    assert.equal(result.stdout, "");
  });

  it("rejects ordinal history with a missing retained release", () => {
    const result = runReleaseContract(
      "plan",
      "scripts/fixtures/release/plan-gapped-history.json",
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, /ordinal history is not contiguous: missing v2/u);
    assert.equal(result.stdout, "");
  });

  it("rejects an ordinal Git tag without a retained immutable release", () => {
    const result = runReleaseContract(
      "plan",
      "scripts/fixtures/release/plan-bare-tag.json",
    );

    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /ordinal Git tags must exactly match retained immutable releases/u,
    );
    assert.equal(result.stdout, "");
  });

  it("rejects a retained ordinal release that is not immutable", () => {
    const result = runReleaseContract(
      "plan",
      "scripts/fixtures/release/plan-mutable-release.json",
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, /v1 is not an immutable published release/u);
    assert.equal(result.stdout, "");
  });

  it("normalizes verified image evidence with a passing vulnerability decision", () => {
    const result = runReleaseContract(
      "evidence",
      "scripts/fixtures/release/evidence-backend.json",
    );

    assert.equal(result.status, 0, result.stderr);
    const evidence = JSON.parse(result.stdout);
    assert.deepEqual(evidence.image, {
      digest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      name: "ghcr.io/sachkov-inside/platform-backend",
    });
    assert.equal(evidence.sourceSha, "3333333333333333333333333333333333333333");
    assert.match(evidence.sbom.documentSha256, /^sha256:[a-f0-9]{64}$/u);
    assert.match(evidence.sbom.bundleSha256, /^sha256:[a-f0-9]{64}$/u);
    assert.match(evidence.provenance.bundleSha256, /^sha256:[a-f0-9]{64}$/u);
    assert.deepEqual(evidence.vulnerabilities, {
      critical: 0,
      decision: "passed",
      high: 0,
      reportSha256: evidence.vulnerabilities.reportSha256,
      waiver: null,
    });
    assert.match(evidence.vulnerabilities.reportSha256, /^sha256:[a-f0-9]{64}$/u);
  });

  it("rejects high or critical vulnerabilities without an owner waiver", () => {
    const result = runEvidenceWith({
      vulnerabilityPath:
        "scripts/fixtures/release/evidence/backend.high-vulnerabilities.json",
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /1 high and 1 critical vulnerabilities require an owner waiver/u);
    assert.equal(result.stdout, "");
  });

  it("records the owner, reason and run when vulnerability findings are waived", () => {
    const waiver = {
      actor: "release-owner",
      reason: "CVE-2026-1000 is not reachable in the production entrypoints",
      runUrl: "https://github.com/sachkov-inside/platform/actions/runs/3003",
    };
    const result = runEvidenceWith({
      vulnerabilityPath:
        "scripts/fixtures/release/evidence/backend.high-vulnerabilities.json",
      waiver,
    });

    assert.equal(result.status, 0, result.stderr);
    const evidence = JSON.parse(result.stdout);
    assert.equal(evidence.vulnerabilities.decision, "waived");
    assert.equal(evidence.vulnerabilities.high, 1);
    assert.equal(evidence.vulnerabilities.critical, 1);
    assert.deepEqual(evidence.vulnerabilities.waiver, waiver);
  });

  it("rejects an SBOM that describes a different image digest", () => {
    const result = runEvidenceWith({
      sbomPath: "scripts/fixtures/release/evidence/backend.tampered.spdx.json",
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /SBOM does not describe the exact image digest/u);
    assert.equal(result.stdout, "");
  });

  it("rejects attestation identities that fall outside the closed evidence schema", () => {
    const result = runEvidenceWith({
      provenanceAttestation: {
        id: "1001",
        unexpected: "field",
        url: "https://github.com/sachkov-inside/platform/attestations/1001",
      },
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /provenanceAttestation.*Unrecognized key/u);
    assert.equal(result.stdout, "");
  });

  it("rejects an attestation URL that does not match its numeric identity", () => {
    const result = runEvidenceWith({
      provenanceAttestation: {
        id: "1001",
        url: "https://github.com/sachkov-inside/platform/attestations/9999",
      },
    });

    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /provenanceAttestation: attestation identity is invalid/u,
    );
    assert.equal(result.stdout, "");
  });

  it("accepts release assets that match the normalized evidence hashes", () => {
    const result = runReleaseContract(
      "assets",
      "scripts/fixtures/release/evidence-assets-valid.json",
    );

    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      JSON.parse(result.stdout).image.name,
      "ghcr.io/sachkov-inside/platform-backend",
    );
  });

  it("rejects a provenance bundle changed after initial verification", () => {
    const result = runReleaseContract(
      "assets",
      "scripts/fixtures/release/evidence-assets-tampered-provenance.json",
    );

    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /provenance bundle does not match normalized evidence/u,
    );
    assert.equal(result.stdout, "");
  });

  it("creates a manifest that binds images, source and runtime identities", () => {
    const result = runReleaseContract(
      "manifest",
      "scripts/fixtures/release/manifest-input.json",
    );

    assert.equal(result.status, 0, result.stderr);
    const manifest = JSON.parse(result.stdout);
    assert.equal(manifest.schemaVersion, "inside.platform.release-manifest.v1");
    assert.equal(manifest.version, "v3");
    assert.equal(manifest.ordinal, 3);
    assert.deepEqual(manifest.source, {
      repository: "sachkov-inside/platform",
      sha: "3333333333333333333333333333333333333333",
    });
    assert.equal(manifest.images.backend.image.name, "ghcr.io/sachkov-inside/platform-backend");
    assert.equal(manifest.images.web.image.name, "ghcr.io/sachkov-inside/platform-web");
    assert.match(manifest.identities.migrations.digest, /^sha256:[a-f0-9]{64}$/u);
    assert.match(manifest.identities.configuration.digest, /^sha256:[a-f0-9]{64}$/u);
    assert.deepEqual(manifest.images.backend.assets, {
      provenanceBundle: "backend.provenance.bundle.json",
      sbomBundle: "backend.sbom.bundle.json",
      sbomDocument: "backend.sbom.spdx.json",
      vulnerabilityReport: "backend.vulnerabilities.json",
    });
  });

  it("rejects evidence fields outside the closed manifest schema", () => {
    const result = runReleaseContract(
      "manifest",
      "scripts/fixtures/release/manifest-invalid-evidence-input.json",
    );

    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /platform-backend evidence: Unrecognized key: "unexpected"/u,
    );
    assert.equal(result.stdout, "");
  });
});

function runReleaseContract(command, inputPath) {
  return spawnSync(
    process.execPath,
    ["scripts/release-contract.mjs", command, "--input", inputPath],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
    },
  );
}

function runEvidenceWith(overrides) {
  const fixture = JSON.parse(
    readFileSync(
      resolve(repositoryRoot, "scripts/fixtures/release/evidence-backend.json"),
      "utf8",
    ),
  );
  const directory = mkdtempSync(resolve(tmpdir(), "platform-release-contract-"));
  const inputPath = resolve(directory, "evidence.json");
  writeFileSync(inputPath, JSON.stringify({ ...fixture, ...overrides }));
  try {
    return runReleaseContract("evidence", inputPath);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}
