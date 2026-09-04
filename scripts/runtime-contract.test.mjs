import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { spawnSync } from "node:child_process";

const manifest = {
  schemaVersion: "inside.platform.release-manifest.v1",
  version: "v3",
  source: {
    repository: "sachkov-inside/platform",
    sha: "3".repeat(40),
  },
  images: {
    backend: `ghcr.io/sachkov-inside/platform-backend@sha256:${"a".repeat(64)}`,
    web: `ghcr.io/sachkov-inside/platform-web@sha256:${"b".repeat(64)}`,
  },
};

describe("production runtime manifest contract", () => {
  it("selects only the two exact image digests from the release manifest", () => {
    const result = run(manifest);

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      schemaVersion: "inside.platform.runtime-plan.v1",
      release: { version: "v3", sourceSha: "3".repeat(40) },
      images: manifest.images,
      composeEnvironment: {
        PLATFORM_BACKEND_IMAGE_DIGEST: "a".repeat(64),
        PLATFORM_BACKEND_IMAGE_REPOSITORY:
          "ghcr.io/sachkov-inside/platform-backend",
        PLATFORM_RELEASE_VERSION: "v3",
        PLATFORM_SOURCE_SHA: "3".repeat(40),
        PLATFORM_WEB_IMAGE_DIGEST: "b".repeat(64),
        PLATFORM_WEB_IMAGE_REPOSITORY:
          "ghcr.io/sachkov-inside/platform-web",
      },
    });
  });

  it("rejects a moving image tag", () => {
    const result = run({
      ...manifest,
      images: { ...manifest.images, backend: "ghcr.io/sachkov-inside/platform-backend:latest" },
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /runtime manifest at images.backend/u);
  });
});

function run(input) {
  const directory = mkdtempSync(resolve(tmpdir(), "inside-runtime-contract-"));
  const path = resolve(directory, "release-manifest.json");
  writeFileSync(path, JSON.stringify(input));
  try {
    return spawnSync(
      process.execPath,
      ["scripts/runtime-contract.mjs", "plan", "--manifest", path],
      { encoding: "utf8" },
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}
