import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, it } from "node:test";

import { writeTrustedReleaseEvidence } from "./github-release-evidence.test-support.mjs";

const gateway = readFileSync("infra/production/host/inside-deploy", "utf8");

describe("inside-deploy forced SSH command", () => {
  it("binds executable payloads to the fixed public GitHub release authority", () => {
    assert.match(
      gateway,
      /https:\/\/api\.github\.com\/repos\/sachkov-inside\/platform\/releases\/tags\/\$version/u,
    );
    assert.match(
      gateway,
      /https:\/\/api\.github\.com\/repos\/sachkov-inside\/platform\/actions\/runs\/\$publication_run_id/u,
    );
    assert.match(gateway, /cmp -s "\$manifest" "\$trusted_manifest"/u);
    assert.match(gateway, /--proto-redir '=https'/u);
  });

  it("stages one verified release and invokes only its bundled command", () => {
    const fixture = createFixture();
    try {
      const result = runGateway(fixture, "deploy v1 101");

      assert.equal(result.status, 0, result.stderr);
      assert.equal(
        readFileSync(resolve(fixture.root, "invocation"), "utf8"),
        "deploy v1 101\n",
      );
      assert.equal(
        readFileSync(
          resolve(
            fixture.root,
            "srv/inside/releases/v1/release-manifest.json",
          ),
          "utf8",
        ),
        fixture.manifest,
      );
    } finally {
      fixture.cleanup();
    }
  });

  it("rejects arbitrary shell commands before reading a payload", () => {
    const fixture = createFixture();
    try {
      const result = runGateway(fixture, "bash -i", "");

      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /restricted command/u);
    } finally {
      fixture.cleanup();
    }
  });

  it("rejects a runtime bundle changed after manifest creation", () => {
    const fixture = createFixture();
    try {
      writeFileSync(fixture.bundle, "tampered bundle");
      createEnvelope(fixture);
      const result = runGateway(fixture, "deploy v1 102");

      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /bundle digest/u);
    } finally {
      fixture.cleanup();
    }
  });

  it("rejects a self-consistent bundle that is not the immutable GitHub release", () => {
    const fixture = createFixture();
    try {
      writeFileSync(
        resolve(fixture.bundleRoot, "bin/deploy-release"),
        '#!/usr/bin/env bash\nset -euo pipefail\nprintf "arbitrary root code\\n" >"$INSIDE_DEPLOY_TEST_ROOT/untrusted-execution"\n',
      );
      const forgedBundleResult = spawnSync(
        "tar",
        [
          "-C",
          fixture.bundleRoot,
          "-czf",
          fixture.bundle,
          "bin/deploy-release",
          "caddy/maintenance.caddy",
          "caddy/platform.caddy",
          "compose.production.yaml",
        ],
        { encoding: "utf8" },
      );
      assert.equal(forgedBundleResult.status, 0, forgedBundleResult.stderr);
      const forgedManifest = JSON.parse(fixture.manifest);
      forgedManifest.source.sha = "9".repeat(40);
      forgedManifest.runtimeBundle.sha256 = sha256(readFileSync(fixture.bundle));
      fixture.manifest = `${JSON.stringify(forgedManifest, null, 2)}\n`;
      createEnvelope(fixture);

      const result = runGateway(fixture, "deploy v1 103");

      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /immutable GitHub release/u);
      assert.equal(
        existsSync(resolve(fixture.root, "untrusted-execution")),
        false,
      );
    } finally {
      fixture.cleanup();
    }
  });

  it("rejects release evidence without a successful publication workflow", () => {
    const fixture = createFixture();
    try {
      writeFileSync(
        resolve(
          fixture.root,
          "etc/inside/test-release-trust/v1/publication-run.json",
        ),
        `${JSON.stringify({
          conclusion: "failure",
          event: "workflow_dispatch",
          head_sha: "1".repeat(40),
          id: 100,
          path: ".github/workflows/release.yml",
        })}\n`,
      );

      const result = runGateway(fixture, "deploy v1 104");

      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /publication workflow is not verified/u);
    } finally {
      fixture.cleanup();
    }
  });

  it("rejects a second command while the server lock is held", () => {
    assert.match(gateway, /flock --exclusive --nonblock/u);
    const fixture = createFixture();
    try {
      const lockMarker = resolve(
        fixture.root,
        "var/lib/inside/deployments/operation.lock.held",
      );
      mkdirSync(resolve(lockMarker, ".."), { recursive: true });
      writeFileSync(lockMarker, "held\n");

      const result = runGateway(fixture, "deploy v1 103");

      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /operation is active/u);
    } finally {
      fixture.cleanup();
    }
  });

  it("rejects a payload above the byte limit without truncating it first", () => {
    assert.match(gateway, /head -c 16777217/u);
    const fixture = createFixture();
    try {
      const result = runGateway(
        fixture,
        "deploy v1 104",
        Buffer.alloc(16 * 1024 * 1024 + 1),
      );

      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /exceeds 16 MiB/u);
    } finally {
      fixture.cleanup();
    }
  });
});

function createFixture() {
  const directory = mkdtempSync(resolve(tmpdir(), "inside-deploy-gateway-"));
  const root = resolve(directory, "host");
  const bin = resolve(directory, "bin");
  const payload = resolve(directory, "payload.tar.gz");
  const bundle = resolve(directory, "production-runtime.tar.gz");
  mkdirSync(bin);
  mkdirSync(resolve(root, "etc/inside"), { recursive: true });
  writeFileSync(resolve(root, "etc/inside/host-provisioned"), "state=ready\n");
  writeExecutable(
    resolve(bin, "flock"),
    `#!/usr/bin/env bash
set -euo pipefail
if [[ -f "$INSIDE_DEPLOY_TEST_ROOT/var/lib/inside/deployments/operation.lock.held" ]]; then
  exit 1
fi
`,
  );

  const bundleRoot = resolve(directory, "bundle");
  mkdirSync(resolve(bundleRoot, "bin"), { recursive: true });
  mkdirSync(resolve(bundleRoot, "caddy"), { recursive: true });
  writeFileSync(
    resolve(bundleRoot, "bin/deploy-release"),
    '#!/usr/bin/env bash\nset -euo pipefail\nprintf "%s %s %s\\n" "$1" "$2" "$3" >"$INSIDE_DEPLOY_TEST_ROOT/invocation"\n',
  );
  chmodSync(resolve(bundleRoot, "bin/deploy-release"), 0o755);
  writeFileSync(resolve(bundleRoot, "caddy/maintenance.caddy"), "maintenance\n");
  writeFileSync(resolve(bundleRoot, "caddy/platform.caddy"), "platform\n");
  writeFileSync(resolve(bundleRoot, "compose.production.yaml"), "services: {}\n");
  const bundleResult = spawnSync(
    "tar",
    [
      "-C",
      bundleRoot,
      "-czf",
      bundle,
      "bin/deploy-release",
      "caddy/maintenance.caddy",
      "caddy/platform.caddy",
      "compose.production.yaml",
    ],
    { encoding: "utf8" },
  );
  assert.equal(bundleResult.status, 0, bundleResult.stderr);

  const manifest = `${JSON.stringify({
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
      sha256: sha256(readFileSync(bundle)),
    },
    publication: { workflowRunId: 100 },
    rollback: { previous: null },
  }, null, 2)}\n`;
  writeTrustedReleaseEvidence(root, {
    manifest,
    publicationRunId: 100,
    sourceSha: "1".repeat(40),
    version: "v1",
  });
  const fixture = {
    bin,
    bundle,
    bundleRoot,
    cleanup: () => rmSync(directory, { force: true, recursive: true }),
    directory,
    manifest,
    payload,
    root,
  };
  createEnvelope(fixture);
  return fixture;
}

function createEnvelope(fixture) {
  const envelopeRoot = resolve(fixture.directory, "envelope");
  rmSync(envelopeRoot, { force: true, recursive: true });
  mkdirSync(envelopeRoot);
  writeFileSync(resolve(envelopeRoot, "release-manifest.json"), fixture.manifest);
  writeFileSync(
    resolve(envelopeRoot, "production-runtime.tar.gz"),
    readFileSync(fixture.bundle),
  );
  const result = spawnSync(
    "tar",
    [
      "-C",
      envelopeRoot,
      "-czf",
      fixture.payload,
      "release-manifest.json",
      "production-runtime.tar.gz",
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
}

function runGateway(fixture, command, input = readFileSync(fixture.payload)) {
  return spawnSync("bash", ["infra/production/host/inside-deploy"], {
    encoding: "utf8",
    env: {
      ...process.env,
      INSIDE_DEPLOY_TEST_ROOT: fixture.root,
      PATH: `${fixture.bin}:${process.env.PATH}`,
      SSH_ORIGINAL_COMMAND: command,
    },
    input,
  });
}

function writeExecutable(path, content) {
  writeFileSync(path, content);
  chmodSync(path, 0o755);
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
