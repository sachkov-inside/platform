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
    const result = runReleaseContractWithInput(
      "plan",
      readJson("scripts/fixtures/release/plan-v3.json"),
    );

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      imageMatrix: [
        {
          kind: "backend",
          dockerfile: "apps/backend/Dockerfile",
          target: "backend-production",
          imageName: "ghcr.io/sachkov-inside/platform-backend",
        },
        {
          kind: "web",
          dockerfile: "apps/web/Dockerfile",
          target: "web-production",
          imageName: "ghcr.io/sachkov-inside/platform-web",
        },
      ],
      manifestAssetName: "release-manifest.json",
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
  });

  it("rejects a release after main moved beyond the captured SHA", () => {
    const result = runReleaseContract(
      "plan",
      "scripts/fixtures/release/plan-stale-main.json",
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, /captured source SHA is not current main/u);
  });

  it("rejects ordinal history with a missing retained release", () => {
    const result = runReleaseContract(
      "plan",
      "scripts/fixtures/release/plan-gapped-history.json",
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, /ordinal history is not contiguous: missing v2/u);
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
  });

  it("rejects a retained ordinal release that is not immutable", () => {
    const result = runReleaseContract(
      "plan",
      "scripts/fixtures/release/plan-mutable-release.json",
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, /v1 is not an immutable published release/u);
  });

  it("creates a deployable manifest from two published image results", () => {
    const result = runReleaseContract(
      "manifest",
      "scripts/fixtures/release/manifest-input.json",
    );

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      schemaVersion: "inside.platform.release-manifest.v1",
      version: "v3",
      source: {
        repository: "sachkov-inside/platform",
        sha: "3333333333333333333333333333333333333333",
      },
      images: {
        backend:
          "ghcr.io/sachkov-inside/platform-backend@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        web: "ghcr.io/sachkov-inside/platform-web@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      },
    });
  });

  it("rejects an image result from another source commit", () => {
    const fixture = readJson(
      "scripts/fixtures/release/manifest/backend.image.json",
    );
    const result = runManifestWithBackend({
      ...fixture,
      sourceSha: "4444444444444444444444444444444444444444",
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /result does not bind the release source/u);
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

function runReleaseContractWithInput(command, input) {
  return spawnSync(
    process.execPath,
    ["scripts/release-contract.mjs", command, "--input", "-"],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      input: JSON.stringify(input),
    },
  );
}

function runManifestWithBackend(backend) {
  return runManifestWithImages(
    backend,
    readJson("scripts/fixtures/release/manifest/web.image.json"),
  );
}

function runManifestWithImages(backend, web) {
  const directory = mkdtempSync(resolve(tmpdir(), "platform-release-manifest-"));
  const backendPath = resolve(directory, "backend.image.json");
  const webPath = resolve(directory, "web.image.json");
  const input = readJson("scripts/fixtures/release/manifest-input.json");
  writeFileSync(backendPath, JSON.stringify(backend));
  writeFileSync(webPath, JSON.stringify(web));
  const inputPath = resolve(directory, "input.json");
  writeFileSync(
    inputPath,
    JSON.stringify({
      ...input,
      images: { backend: backendPath, web: webPath },
    }),
  );
  try {
    return runReleaseContract("manifest", inputPath);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(resolve(repositoryRoot, path), "utf8"));
}
