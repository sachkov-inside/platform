import assert from "node:assert/strict";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const command = resolve(
  repositoryRoot,
  "infra/production/host/host-foundation.py",
);
const manifest = JSON.parse(
  readFileSync(
    resolve(repositoryRoot, "infra/production/host/foundation.json"),
    "utf8",
  ),
);

describe("production host foundation", () => {
  it("converges twice on a clean managed root without changing rendered state", () => {
    const fixture = createFixture();

    run(fixture, "bootstrap", "--skip-packages");
    const first = snapshot(fixture.root);
    run(fixture, "bootstrap", "--skip-packages");
    const second = snapshot(fixture.root);

    assert.deepEqual(second, first);
    assert.equal(mode(resolve(fixture.root, "run/inside/secrets")), 0o700);
    assert.equal(
      mode(resolve(fixture.root, "etc/sudoers.d/inside-deploy")),
      0o440,
    );
    assert.equal(
      readlinkSync(resolve(fixture.root, "opt/inside/foundation/current")),
      "v1",
    );
    assert.equal(mode(resolve(fixture.root, "etc/inside/age")), 0o700);
    assert.equal(
      mode(
        resolve(
          fixture.root,
          "opt/inside/foundation/v1/infra/production/database/database-backup",
        ),
      ),
      0o755,
    );
  });

  it("fails closed for unsupported, undersized and unmanaged hosts", () => {
    const unsupported = createFixture({ osVersion: "22.04" });
    assertFailure(runRaw(unsupported, "preflight"), "osVersion");

    const undersized = createFixture({ memoryBytes: 1024 });
    assertFailure(runRaw(undersized, "preflight"), "memoryBytes");

    const unmanaged = createFixture();
    mkdirSync(resolve(unmanaged.root, "var/lib/inside"), { recursive: true });
    writeFileSync(resolve(unmanaged.root, "var/lib/inside/foreign"), "owned elsewhere");
    assertFailure(runRaw(unmanaged, "preflight"), "unmanagedStatePath");

    const foreignRelease = createFixture();
    mkdirSync(resolve(foreignRelease.root, "srv/inside/releases/v99"), {
      recursive: true,
    });
    assertFailure(
      runRaw(foreignRelease, "preflight"),
      "unmanagedReleasePath",
    );
  });

  it("allows only versioned release commands and switches current/previous atomically", () => {
    const fixture = createFixture();
    run(fixture, "bootstrap", "--skip-packages");
    assert.equal(deploy(fixture, "foundation preflight").stdout.trim(), "foundation ready");

    deploy(fixture, "release prepare v1");
    writeSafeManifest(fixture.root, "v1");
    deploy(fixture, "release activate v1");
    deploy(fixture, "release prepare v2");
    writeSafeManifest(fixture.root, "v2");
    deploy(fixture, "release activate v2");

    assert.deepEqual(JSON.parse(deploy(fixture, "release status").stdout), {
      current: "v2",
      previous: "v1",
    });
    assertFailure(deployRaw(fixture, "release prepare ../escape"), "vN");
    assertFailure(deployRaw(fixture, "bash -lc id"), "not allowlisted");
    assert.equal(statSync(resolve(fixture.root, "etc")).isDirectory(), true);
  });

  it("rejects unsafe release manifests and unbounded staging", () => {
    const fixture = createFixture();
    run(fixture, "bootstrap", "--skip-packages");
    for (const version of ["v1", "v2", "v3", "v4"]) {
      deploy(fixture, `release prepare ${version}`);
    }
    assertFailure(
      deployRaw(fixture, "release prepare v5"),
      "retention limit",
    );

    writeSafeManifest(fixture.root, "v1");
    chmodSync(
      resolve(fixture.root, "srv/inside/releases/v1/manifest.json"),
      0o666,
    );
    assertFailure(
      deployRaw(fixture, "release activate v1"),
      "permissions are unsafe",
    );

    const unsafe = resolve(fixture.root, "srv/inside/releases/v2/manifest.json");
    symlinkSync("/etc/passwd", unsafe);
    assertFailure(
      deployRaw(fixture, "release activate v2"),
      "must not be a symlink",
    );
  });

  it("prunes only inactive versions and reserves the next bounded slot", () => {
    const fixture = createFixture();
    run(fixture, "bootstrap", "--skip-packages");
    for (const version of ["v1", "v2", "v3", "v4"]) {
      deploy(fixture, `release prepare ${version}`);
      writeSafeManifest(fixture.root, version);
    }
    deploy(fixture, "release activate v3");
    deploy(fixture, "release activate v4");

    assert.deepEqual(JSON.parse(deploy(fixture, "release prune").stdout), {
      removed: ["v1"],
    });
    deploy(fixture, "release prepare v5");
    assert.equal(
      statSync(resolve(fixture.root, "srv/inside/releases/v3")).isDirectory(),
      true,
    );
    assert.equal(
      statSync(resolve(fixture.root, "srv/inside/releases/v4")).isDirectory(),
      true,
    );
  });
});

function createFixture(overrides = {}) {
  const root = mkdtempSync(resolve(tmpdir(), "inside-host-root-"));
  const factsPath = resolve(root, "facts.json");
  writeFileSync(
    factsPath,
    JSON.stringify({
      architecture: manifest.host.architecture,
      availableDiskBytes: manifest.capacity.minimumDiskBytes,
      cpuCount: manifest.capacity.minimumCpuCount,
      effectiveUserId: 0,
      memoryBytes: manifest.capacity.minimumMemoryBytes,
      osId: manifest.host.osId,
      osVersion: manifest.host.osVersion,
      ...overrides,
    }),
  );
  return { factsPath, root };
}

function run(fixture, ...arguments_) {
  const result = runRaw(fixture, ...arguments_);
  assert.equal(result.status, 0, result.stderr);
  return result;
}

function runRaw(fixture, ...arguments_) {
  return spawnSync(
    "python3",
    [command, ...arguments_, "--root", fixture.root, "--facts", fixture.factsPath],
    { encoding: "utf8" },
  );
}

function deploy(fixture, originalCommand) {
  const result = deployRaw(fixture, originalCommand);
  assert.equal(result.status, 0, result.stderr);
  return result;
}

function deployRaw(fixture, originalCommand) {
  return spawnSync(
    "python3",
    [
      command,
      "deploy",
      "--root",
      fixture.root,
      "--original-command",
      originalCommand,
    ],
    { encoding: "utf8" },
  );
}

function writeSafeManifest(root, version) {
  const path = resolve(root, `srv/inside/releases/${version}/manifest.json`);
  writeFileSync(path, JSON.stringify({ version }));
  chmodSync(path, 0o640);
}

function assertFailure(result, message) {
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, new RegExp(message, "u"));
}

function mode(path) {
  return statSync(path).mode & 0o777;
}

function snapshot(root) {
  const paths = [
    "etc/caddy/Caddyfile",
    "etc/ssh/sshd_config.d/inside-deploy.conf",
    "etc/sudoers.d/inside-deploy",
    "etc/systemd/system/inside-pgbackrest-backup@.service",
    "etc/systemd/system/inside-pgbackrest-diff.timer",
    "etc/systemd/system/inside-pgbackrest-full.timer",
    "etc/systemd/system/inside-pgbackrest-incr.timer",
    "opt/inside/foundation/v1/infra/identity/logto/Dockerfile",
    "opt/inside/foundation/v1/infra/production/database/backup-policy.json",
    "opt/inside/foundation/v1/infra/production/database/database-backup",
    "opt/inside/foundation/v1/infra/production/logto/compose.yaml",
    "opt/inside/foundation/v1/infra/production/secrets/secret-policy.json",
    "opt/inside/foundation/v1/infra/production/secrets/production-secrets.mjs",
    "usr/local/libexec/inside/database-backup",
    "usr/local/libexec/inside/foundation.json",
    "usr/local/libexec/inside/host-foundation.py",
    "usr/local/libexec/inside/inside-deploy-command",
    "var/lib/inside/.inside-foundation",
  ];
  return Object.fromEntries(
    paths.map((path) => [
      path,
      {
        content: readFileSync(resolve(root, path), "utf8"),
        mode: mode(resolve(root, path)),
      },
    ]),
  );
}
