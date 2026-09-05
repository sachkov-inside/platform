import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, it } from "node:test";

describe("release rollback proof", () => {
  it("binds the exact previous manifest and both image schema identities", () => {
    const fixture = createFixture();
    try {
      const compatible = run(fixture.inputPath);
      assert.equal(compatible.status, 0, compatible.stderr);
      assert.deepEqual(JSON.parse(compatible.stdout).rollback.previous, {
        version: "v1",
        sourceSha: "1".repeat(40),
        manifestSha256: sha256(fixture.previousManifest),
        schemaIdentity: `sha256:${"c".repeat(64)}`,
        compatible: true,
        verifiedByWorkflowRunId: 202,
      });

      const incompatibleInput = {
        ...fixture.input,
        schemaIdentity: `sha256:${"d".repeat(64)}`,
      };
      writeFileSync(fixture.inputPath, JSON.stringify(incompatibleInput));
      const incompatible = run(fixture.inputPath);
      assert.equal(incompatible.status, 0, incompatible.stderr);
      assert.equal(
        JSON.parse(incompatible.stdout).rollback.previous.compatible,
        false,
      );
    } finally {
      fixture.cleanup();
    }
  });

  it("rejects a previous image identity that differs from its manifest", () => {
    const fixture = createFixture();
    try {
      writeFileSync(
        fixture.inputPath,
        JSON.stringify({
          ...fixture.input,
          rollback: {
            previous: {
              ...fixture.input.rollback.previous,
              schemaIdentity: `sha256:${"f".repeat(64)}`,
            },
          },
        }),
      );
      const result = run(fixture.inputPath);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /previous backend image does not match/u);
    } finally {
      fixture.cleanup();
    }
  });
});

function createFixture() {
  const directory = mkdtempSync(resolve(tmpdir(), "inside-rollback-proof-"));
  const previousManifest = `${JSON.stringify({
    schemaVersion: "inside.platform.release-manifest.v2",
    version: "v1",
    source: {
      repository: "sachkov-inside/platform",
      sha: "1".repeat(40),
    },
    images: {
      backend: `ghcr.io/sachkov-inside/platform-backend@sha256:${"a".repeat(64)}`,
      web: `ghcr.io/sachkov-inside/platform-web@sha256:${"b".repeat(64)}`,
    },
    schema: { identity: `sha256:${"c".repeat(64)}` },
    runtimeBundle: {
      asset: "production-runtime.tar.gz",
      sha256: `sha256:${"d".repeat(64)}`,
    },
    publication: { workflowRunId: 101 },
    rollback: { previous: null },
  }, null, 2)}\n`;
  const previousPath = resolve(directory, "previous.json");
  const backendPath = resolve(directory, "backend.json");
  const webPath = resolve(directory, "web.json");
  const bundlePath = resolve(directory, "runtime.tar.gz");
  const inputPath = resolve(directory, "input.json");
  writeFileSync(previousPath, previousManifest);
  writeFileSync(
    backendPath,
    JSON.stringify({
      image: {
        name: "ghcr.io/sachkov-inside/platform-backend",
        digest: `sha256:${"e".repeat(64)}`,
      },
      sourceSha: "2".repeat(40),
    }),
  );
  writeFileSync(
    webPath,
    JSON.stringify({
      image: {
        name: "ghcr.io/sachkov-inside/platform-web",
        digest: `sha256:${"f".repeat(64)}`,
      },
      sourceSha: "2".repeat(40),
    }),
  );
  writeFileSync(bundlePath, "runtime bundle");
  const input = {
    version: "v2",
    sourceSha: "2".repeat(40),
    repository: "sachkov-inside/platform",
    images: { backend: backendPath, web: webPath },
    schemaIdentity: `sha256:${"c".repeat(64)}`,
    runtimeBundle: bundlePath,
    publicationWorkflowRunId: 202,
    rollback: {
      previous: {
        manifest: previousPath,
        schemaIdentity: `sha256:${"c".repeat(64)}`,
      },
    },
  };
  writeFileSync(inputPath, JSON.stringify(input));
  return {
    cleanup: () => rmSync(directory, { force: true, recursive: true }),
    input,
    inputPath,
    previousManifest,
  };
}

function run(path) {
  return spawnSync(
    process.execPath,
    ["scripts/release-contract.mjs", "manifest", "--input", path],
    { encoding: "utf8" },
  );
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
