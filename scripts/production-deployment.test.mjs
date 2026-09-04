import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, it } from "node:test";

describe("production deployment state machine", () => {
  it("deploys v1, repeats as a no-op, deploys v2 and rolls back to v1", () => {
    const fixture = createHostFixture();
    try {
      assertGatewaySuccess(fixture, "deploy", "v1", 101);
      let state = readState(fixture);
      assert.equal(state.current.version, "v1");
      assert.equal(state.previous, null);
      assert.equal(state.rollback, null);

      const firstExternalLog = readExternalLog(fixture);
      assertGatewaySuccess(fixture, "deploy", "v1", 102);
      assert.equal(readExternalLog(fixture), firstExternalLog);

      assertGatewaySuccess(fixture, "deploy", "v2", 103);
      state = readState(fixture);
      assert.equal(state.current.version, "v2");
      assert.equal(state.previous.version, "v1");
      assert.equal(state.rollback.targetVersion, "v1");
      assert.equal(state.rollback.compatible, true);
      assert.ok(state.rollback.expiresAtEpochSeconds > state.current.deployedAtEpochSeconds);

      const beforeRollback = readExternalLog(fixture);
      assertGatewaySuccess(fixture, "rollback", "v1", 104);
      state = readState(fixture);
      assert.equal(state.operation, "rollback");
      assert.equal(state.current.version, "v1");
      assert.equal(state.previous, null);
      assert.equal(state.rollback, null);
      assert.equal(state.rolledBackFrom.version, "v2");
      const journals = `${JSON.stringify(state)}${readFileSync(
        resolve(fixture.root, "var/lib/inside/deployments/operation.json"),
        "utf8",
      )}`;
      assert.doesNotMatch(journals, /test-only-secret-value/u);
      assert.doesNotMatch(
        readExternalLog(fixture).slice(beforeRollback.length),
        / run --rm migrations/u,
      );
    } finally {
      fixture.cleanup();
    }
  });

  for (const phase of ["preflight", "migrations", "readiness", "smoke"]) {
    it(`records ${phase} failure and safely repeats the same deployment`, () => {
      const fixture = createHostFixture();
      try {
        const failed = runGateway(fixture, "deploy", "v1", 201, {
          INSIDE_DEPLOY_FAIL_PHASE: phase,
        });

        assert.notEqual(failed.status, 0);
        const operation = JSON.parse(
          readFileSync(
            resolve(
              fixture.root,
              "var/lib/inside/deployments/operation.json",
            ),
            "utf8",
          ),
        );
        assert.equal(operation.status, "failed");
        assert.equal(operation.phase, phase);
        const activeCaddy = resolve(
          fixture.root,
          "srv/inside/runtime/caddy/active.caddy",
        );
        if (phase === "preflight") {
          assert.equal(existsSync(activeCaddy), false);
        } else {
          assert.match(readFileSync(activeCaddy, "utf8"), /Deployment in progress/u);
        }

        assertGatewaySuccess(fixture, "deploy", "v1", 202);
        assert.equal(readState(fixture).current.version, "v1");
      } finally {
        fixture.cleanup();
      }
    });
  }

  it("rejects stale, incompatible and expired rollback selections", () => {
    const stale = createHostFixture();
    try {
      assertGatewaySuccess(stale, "deploy", "v1", 301);
      assertGatewaySuccess(stale, "deploy", "v2", 302);
      const result = runGateway(stale, "deploy", "v1", 303);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /next ordinal/u);
    } finally {
      stale.cleanup();
    }

    const incompatible = createHostFixture({ compatible: false });
    try {
      assertGatewaySuccess(incompatible, "deploy", "v1", 304);
      assertGatewaySuccess(incompatible, "deploy", "v2", 305);
      const result = runGateway(incompatible, "rollback", "v1", 306);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /incompatible or expired/u);
    } finally {
      incompatible.cleanup();
    }

    const expired = createHostFixture();
    try {
      assert.equal(
        runGateway(expired, "deploy", "v1", 307, {
          INSIDE_DEPLOY_TEST_NOW_EPOCH: "100",
        }).status,
        0,
      );
      assert.equal(
        runGateway(expired, "deploy", "v2", 308, {
          INSIDE_DEPLOY_TEST_NOW_EPOCH: "200",
        }).status,
        0,
      );
      const result = runGateway(expired, "rollback", "v1", 309, {
        INSIDE_DEPLOY_TEST_NOW_EPOCH: "86601",
      });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /incompatible or expired/u);
    } finally {
      expired.cleanup();
    }
  });
});

function createHostFixture({ compatible = true } = {}) {
  const directory = mkdtempSync(resolve(tmpdir(), "inside-production-host-"));
  const root = resolve(directory, "host");
  const bin = resolve(directory, "bin");
  mkdirSync(resolve(root, "etc/inside/runtime"), { recursive: true });
  mkdirSync(resolve(root, "etc/caddy"), { recursive: true });
  mkdirSync(bin);
  writeFileSync(resolve(root, "etc/inside/host-provisioned"), "state=ready\n");
  writeFileSync(resolve(root, "etc/caddy/Caddyfile"), "test config\n");
  writeFileSync(
    resolve(root, "etc/inside/runtime/compose.env"),
    [
      "PLATFORM_COMPOSE_PROJECT=inside-platform-test",
      "PLATFORM_API_LOOPBACK_PORT=13001",
      "PLATFORM_MCP_LOOPBACK_PORT=13002",
      "PLATFORM_WEB_LOOPBACK_PORT=13000",
      "PLATFORM_EDGE_NETWORK=inside-platform-edge-test",
      "PLATFORM_APPLICATION_NETWORK=inside-platform-application-test",
      "FOUNDATION_DATABASE_NETWORK=inside-platform-database-test",
      "",
    ].join("\n"),
  );
  for (const name of [
    "api.env",
    "material-assets-worker.env",
    "mcp.env",
    "migrations.env",
    "profile-avatars-worker.env",
    "video-deletions-worker.env",
    "web.env",
  ]) {
    writeFileSync(
      resolve(root, "etc/inside/runtime", name),
      name === "api.env"
        ? "CONFIGURED=true\nAPI_SECRET=test-only-secret-value\n"
        : "CONFIGURED=true\n",
    );
  }

  writeExecutable(
    resolve(bin, "docker"),
    '#!/usr/bin/env bash\nset -euo pipefail\nprintf "docker %s\\n" "$*" >>"$INSIDE_DEPLOY_TEST_ROOT/external.log"\n',
  );
  writeExecutable(
    resolve(bin, "caddy"),
    '#!/usr/bin/env bash\nset -euo pipefail\nprintf "caddy %s\\n" "$*" >>"$INSIDE_DEPLOY_TEST_ROOT/external.log"\n',
  );
  writeExecutable(
    resolve(bin, "curl"),
    `#!/usr/bin/env bash
set -euo pipefail
printf "curl %s\\n" "$*" >>"$INSIDE_DEPLOY_TEST_ROOT/external.log"
url="\${*: -1}"
if [[ "$url" == */health/ready || "$url" == */_health/ready ]]; then
  printf '{"status":"ready","release":{"release":"%s","sourceSha":"%s"},"schema":{"identity":"%s","migrationCount":1}}\\n' \\
    "$PLATFORM_RELEASE_VERSION" "$PLATFORM_SOURCE_SHA" "$INSIDE_DEPLOY_EXPECTED_SCHEMA"
else
  printf 'ok\\n'
fi
`,
  );

  const bundle = resolve(directory, "production-runtime.tar.gz");
  const build = spawnSync(
    "bash",
    ["scripts/build-production-runtime-bundle.sh", bundle],
    { encoding: "utf8" },
  );
  assert.equal(build.status, 0, build.stderr);
  const bundleDigest = sha256(readFileSync(bundle));
  const schemaIdentity = `sha256:${"c".repeat(64)}`;
  const v1Manifest = releaseManifest({
    bundleDigest,
    runId: 91,
    schemaIdentity,
    sourceSha: "1".repeat(40),
    version: "v1",
    previous: null,
  });
  const v1ManifestDigest = sha256(v1Manifest);
  const v2Manifest = releaseManifest({
    bundleDigest,
    runId: 92,
    schemaIdentity,
    sourceSha: "2".repeat(40),
    version: "v2",
    previous: {
      version: "v1",
      sourceSha: "1".repeat(40),
      manifestSha256: v1ManifestDigest,
      schemaIdentity,
      compatible,
      verifiedByWorkflowRunId: 92,
    },
  });

  const fixture = {
    bin,
    bundle,
    cleanup: () => rmSync(directory, { force: true, recursive: true }),
    directory,
    manifests: { v1: v1Manifest, v2: v2Manifest },
    root,
  };
  for (const version of ["v1", "v2"]) {
    createEnvelope(fixture, version);
  }
  return fixture;
}

function releaseManifest({
  bundleDigest,
  previous,
  runId,
  schemaIdentity,
  sourceSha,
  version,
}) {
  return `${JSON.stringify({
    schemaVersion: "inside.platform.release-manifest.v2",
    version,
    source: { repository: "sachkov-inside/platform", sha: sourceSha },
    images: {
      backend: `ghcr.io/sachkov-inside/platform-backend@sha256:${(version === "v1" ? "a" : "d").repeat(64)}`,
      web: `ghcr.io/sachkov-inside/platform-web@sha256:${(version === "v1" ? "b" : "e").repeat(64)}`,
    },
    schema: { identity: schemaIdentity },
    runtimeBundle: {
      asset: "production-runtime.tar.gz",
      sha256: bundleDigest,
    },
    publication: { workflowRunId: runId },
    rollback: { previous },
  }, null, 2)}\n`;
}

function createEnvelope(fixture, version) {
  const root = resolve(fixture.directory, `envelope-${version}`);
  mkdirSync(root);
  writeFileSync(resolve(root, "release-manifest.json"), fixture.manifests[version]);
  copyFileSync(fixture.bundle, resolve(root, "production-runtime.tar.gz"));
  const result = spawnSync(
    "tar",
    [
      "-C",
      root,
      "-czf",
      resolve(fixture.directory, `${version}.tar.gz`),
      "release-manifest.json",
      "production-runtime.tar.gz",
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
}

function assertGatewaySuccess(fixture, operation, version, runId) {
  const result = runGateway(fixture, operation, version, runId);
  assert.equal(result.status, 0, result.stderr);
}

function runGateway(fixture, operation, version, runId, extraEnvironment = {}) {
  return spawnSync("bash", ["infra/production/host/inside-deploy"], {
    encoding: "utf8",
    env: {
      ...process.env,
      INSIDE_DEPLOY_TEST_ROOT: fixture.root,
      PATH: `${fixture.bin}:${process.env.PATH}`,
      SSH_ORIGINAL_COMMAND: `${operation} ${version} ${String(runId)}`,
      ...extraEnvironment,
    },
    input: readFileSync(resolve(fixture.directory, `${version}.tar.gz`)),
  });
}

function readState(fixture) {
  return JSON.parse(
    readFileSync(
      resolve(fixture.root, "var/lib/inside/deployments/state.json"),
      "utf8",
    ),
  );
}

function readExternalLog(fixture) {
  const path = resolve(fixture.root, "external.log");
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function writeExecutable(path, content) {
  writeFileSync(path, content);
  chmodSync(path, 0o755);
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
