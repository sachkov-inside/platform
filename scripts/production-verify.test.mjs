// @ts-check
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("production verifier unit tests pass without production credentials or Docker", () => {
  const result = spawnSync(
    "python3",
    [
      "-m",
      "unittest",
      "discover",
      "-s",
      "scripts/production-verify",
      "-p",
      "test_verify.py",
    ],
    { encoding: "utf8" },
  );
  assert.equal(
    result.status,
    0,
    result.stderr || result.error?.message || "python3 unit tests failed",
  );
});

test("production verifier refuses path traversal before any server access", () => {
  const result = spawnSync(
    "python3",
    [
      "scripts/production-verify/verify.py",
      "--local",
      "--application",
      "platform",
      "--version",
      "../../etc/inside",
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 2);
  assert.match(result.stderr, /version must be vN/u);
});

// Use the release producers themselves as independent sources of valid manifests.
import { validateContext } from "./production-verify/validate-context.mjs";
import { releaseManifestSchema } from "../release/contract-schema.mjs";
import { createManifest as createTelegramManifest } from "../apps/telegram/scripts/release-contract.mjs";

function platformContext() {
  const produced = spawnSync(
    process.execPath,
    [
      "scripts/release-contract.mjs",
      "manifest",
      "--input",
      "scripts/fixtures/release/manifest-input.json",
    ],
    { encoding: "utf8" },
  );
  assert.equal(produced.status, 0, produced.stderr);
  /** @type {unknown} */
  const input = JSON.parse(produced.stdout);
  const manifest = releaseManifestSchema.parse(input);
  const state = {
    schemaVersion: "inside.platform.deployment-state.v1",
    status: "succeeded",
    operation: "deploy",
    current: {
      version: manifest.version,
      sourceSha: manifest.source.sha,
      backendImage: manifest.images.backend,
      webImage: manifest.images.web,
      schemaIdentity: manifest.schema.identity,
      manifestSha256: `sha256:${"a".repeat(64)}`,
    },
    previous: null,
    rollback: null,
    rolledBackFrom: null,
  };
  return {
    application: "platform",
    version: manifest.version,
    manifest,
    state,
  };
}

test("canonical release producer output and deployment state are accepted", () => {
  const { manifest, state, ...context } = platformContext();
  assert.equal(
    validateContext({
      ...context,
      manifestRaw: JSON.stringify(manifest),
      stateRaw: JSON.stringify(state),
    }),
    true,
  );
});

test("unknown manifest generation, malformed digest and malformed state are rejected", () => {
  const { manifest, state, ...context } = platformContext();
  for (const invalidManifest of [
    { ...manifest, schemaVersion: "unknown" },
    { ...manifest, source: { ...manifest.source, sha: "short" } },
    {
      ...manifest,
      images: {
        ...manifest.images,
        backend: "ghcr.io/sachkov-inside/platform-backend:latest",
      },
    },
  ]) {
    assert.equal(
      validateContext({
        ...context,
        manifestRaw: JSON.stringify(invalidManifest),
        stateRaw: JSON.stringify(state),
      }),
      false,
    );
  }
  assert.equal(
    validateContext({
      ...context,
      manifestRaw: JSON.stringify(manifest),
      stateRaw: JSON.stringify({
        ...state,
        rollback: { targetVersion: "v1", compatible: "false" },
      }),
    }),
    false,
  );
});

test("Telegram release producer output uses the same source and digest formats", async () => {
  const manifest = await createTelegramManifest({
    version: "v9",
    sourceSha: "1".repeat(40),
    imageDigest: `sha256:${"a".repeat(64)}`,
    composePath: "apps/telegram/infra/production/compose.yaml",
    caddyPath: "apps/telegram/infra/production/telegram.caddy",
    workflowRunId: 123,
    serverUrl: "https://github.com",
  });
  const state = {
    current: {
      version: manifest.version,
      sourceSha: manifest.source.sha,
      image: manifest.image,
      migrationsIdentity: manifest.migrations.identity,
      manifestSha256: `sha256:${"b".repeat(64)}`,
      operation: "deploy",
      githubRunId: 123,
      completedAt: "2026-10-08T00:00:00Z",
    },
    previous: null,
  };
  assert.equal(
    validateContext({
      application: "telegram",
      version: manifest.version,
      manifestRaw: JSON.stringify(manifest),
      stateRaw: JSON.stringify(state),
    }),
    true,
  );
});
