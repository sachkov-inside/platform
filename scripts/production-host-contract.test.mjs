import assert from "node:assert/strict";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(repositoryRoot, path), "utf8");

test("production host bootstrap is restrictive, idempotent and preserves runtime secrets", () => {
  const temporaryRoot = mkdtempSync(join(realpathSync(tmpdir()), "inside-platform-host-"));
  const installRoot = join(temporaryRoot, "platform");

  try {
    const firstRun = runScript("scripts/bootstrap-production-host.sh", [], {
      PLATFORM_INSTALL_ROOT: installRoot,
    });
    assert.equal(firstRun.status, 0, firstRun.stderr);

    const runtimeEnvironment = join(installRoot, "shared", "runtime.env");
    assert.equal(modeOf(installRoot), "0750");
    assert.equal(modeOf(join(installRoot, "releases")), "0750");
    assert.equal(modeOf(join(installRoot, "shared")), "0700");
    assert.equal(modeOf(runtimeEnvironment), "0600");
    assert.equal(readFileSync(runtimeEnvironment, "utf8"), read(".env.production.example"));

    const sentinel = "POSTGRES_PASSWORD=server-only-secret\n";
    writeFileSync(runtimeEnvironment, sentinel, { mode: 0o600 });
    const repeatedRun = runScript("scripts/bootstrap-production-host.sh", [], {
      PLATFORM_INSTALL_ROOT: installRoot,
    });
    assert.equal(repeatedRun.status, 0, repeatedRun.stderr);
    assert.equal(readFileSync(runtimeEnvironment, "utf8"), sentinel);

    const relativeRoot = runScript("scripts/bootstrap-production-host.sh", [], {
      PLATFORM_INSTALL_ROOT: "relative/platform",
    });
    assert.notEqual(relativeRoot.status, 0);
    assert.match(relativeRoot.stderr, /absolute/u);

    const filesystemRootMode = modeOf("/");
    const filesystemRoot = runScript("scripts/bootstrap-production-host.sh", [], {
      PLATFORM_INSTALL_ROOT: "/",
    });
    assert.notEqual(filesystemRoot.status, 0);
    assert.match(filesystemRoot.stderr, /non-root/u);
    assert.equal(modeOf("/"), filesystemRootMode);

    const lexicalAlias = runScript("scripts/bootstrap-production-host.sh", [], {
      PLATFORM_INSTALL_ROOT: `${temporaryRoot}/platform/../alias`,
    });
    assert.notEqual(lexicalAlias.status, 0);
    assert.match(lexicalAlias.stderr, /canonical/u);

    const symlinkTarget = join(temporaryRoot, "symlink-target");
    const symlinkParent = join(temporaryRoot, "symlink-parent");
    mkdirSync(symlinkTarget);
    symlinkSync(symlinkTarget, symlinkParent);
    const symlinkedParent = runScript("scripts/bootstrap-production-host.sh", [], {
      PLATFORM_INSTALL_ROOT: join(symlinkParent, "platform"),
    });
    assert.notEqual(symlinkedParent.status, 0);
    assert.match(symlinkedParent.stderr, /symbolic link/u);

    const outsideReleases = join(temporaryRoot, "outside-releases");
    mkdirSync(outsideReleases, { mode: 0o777 });
    rmSync(join(installRoot, "releases"), { recursive: true });
    symlinkSync(outsideReleases, join(installRoot, "releases"));
    const symlinkedChild = runScript("scripts/bootstrap-production-host.sh", [], {
      PLATFORM_INSTALL_ROOT: installRoot,
    });
    assert.notEqual(symlinkedChild.status, 0);
    assert.match(symlinkedChild.stderr, /symbolic link/u);
  } finally {
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});

test("release metadata renderer transforms workflow digests exactly once", () => {
  const sourceRevision = "a".repeat(40);
  const apiWorkflowDigest = `sha256:${"b".repeat(64)}`;
  const webWorkflowDigest = `sha256:${"c".repeat(64)}`;

  const rendered = runScript("scripts/render-production-release-env.sh", [
    "--",
    sourceRevision,
    apiWorkflowDigest,
    webWorkflowDigest,
  ]);
  assert.equal(rendered.status, 0, rendered.stderr);
  assert.equal(rendered.stdout, validReleaseEnvironment());

  const missingPrefix = runScript("scripts/render-production-release-env.sh", [
    sourceRevision,
    "b".repeat(64),
    webWorkflowDigest,
  ]);
  assert.notEqual(missingPrefix.status, 0);
  assert.match(missingPrefix.stderr, /sha256/u);
});

test("runtime and release templates keep secrets and immutable image inputs separate", () => {
  const runtimeTemplate = read(".env.production.example");
  const releaseTemplate = read(".env.release.example");

  assert.doesNotMatch(runtimeTemplate, /PLATFORM_(?:API|MIGRATION|WEB)_IMAGE_/u);
  assert.match(runtimeTemplate, /POSTGRES_PASSWORD=/u);
  assert.match(runtimeTemplate, /LOGTO_APP_SECRET=/u);
  assert.match(runtimeTemplate, /TELEGRAM_LINKING_SECRET=/u);

  const releaseKeys = releaseTemplate
    .split("\n")
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => line.split("=", 1)[0]);
  assert.deepEqual(releaseKeys, [
    "SOURCE_REVISION",
    "PLATFORM_API_IMAGE_REPOSITORY",
    "PLATFORM_API_IMAGE_DIGEST",
    "PLATFORM_MIGRATION_IMAGE_REPOSITORY",
    "PLATFORM_MIGRATION_IMAGE_DIGEST",
    "PLATFORM_WEB_IMAGE_REPOSITORY",
    "PLATFORM_WEB_IMAGE_DIGEST",
  ]);
  assert.doesNotMatch(
    releaseTemplate,
    /PASSWORD|SECRET|DATABASE_URL|LOGTO|TELEGRAM|COOKIE|PRIVATE|TOKEN/u,
  );
  assert.match(read(".gitignore"), /^!\.env\.release\.example$/mu);
});

test("production host validation fails closed and never prints runtime secrets", () => {
  const temporaryRoot = mkdtempSync(join(realpathSync(tmpdir()), "inside-platform-validation-"));

  try {
    const runtimeEnvironment = join(temporaryRoot, "runtime.env");
    const releaseEnvironment = join(temporaryRoot, "release.env");
    const fakeBin = join(temporaryRoot, "bin");
    const dockerArguments = join(temporaryRoot, "docker-arguments");
    const secret = "server-only-secret-never-print";
    mkdirSync(fakeBin);
    writeFileSync(join(fakeBin, "docker"), fakeDockerScript(dockerArguments), { mode: 0o755 });
    writeFileSync(runtimeEnvironment, validRuntimeEnvironment(secret), { mode: 0o600 });
    writeFileSync(releaseEnvironment, validReleaseEnvironment(), { mode: 0o600 });

    const valid = runScript(
      "scripts/validate-production-host.sh",
      ["--", runtimeEnvironment, releaseEnvironment],
      {
        PATH: `${fakeBin}:${process.env.PATH}`,
        COMPOSE_PROJECT_NAME: "ambient-project-must-not-leak",
        PLATFORM_HTTP_PORT: "18080",
        PLATFORM_HTTPS_PORT: "18443",
      },
    );
    assert.equal(valid.status, 0, valid.stderr);
    assert.equal(valid.stdout.includes(secret), false);
    assert.equal(valid.stderr.includes(secret), false);
    assert.match(
      readFileSync(dockerArguments, "utf8"),
      new RegExp(
        `^COMPOSE_PROJECT_NAME=<unset>\\nPLATFORM_HTTP_PORT=<unset>\\nPLATFORM_HTTPS_PORT=<unset>\\ncompose\\n--env-file\\n${escapeRegExp(runtimeEnvironment)}\\n--env-file\\n${escapeRegExp(releaseEnvironment)}\\n`,
        "u",
      ),
    );

    const realEnvironmentDirectory = join(temporaryRoot, "real-environment");
    const symlinkedEnvironmentDirectory = join(temporaryRoot, "environment-link");
    mkdirSync(realEnvironmentDirectory);
    const linkedRuntimeEnvironment = join(realEnvironmentDirectory, "runtime.env");
    const linkedReleaseEnvironment = join(realEnvironmentDirectory, "release.env");
    writeFileSync(linkedRuntimeEnvironment, validRuntimeEnvironment(secret), { mode: 0o600 });
    writeFileSync(linkedReleaseEnvironment, validReleaseEnvironment(), { mode: 0o600 });
    symlinkSync(realEnvironmentDirectory, symlinkedEnvironmentDirectory);
    const symlinkedParent = runScript("scripts/validate-production-host.sh", [
      join(symlinkedEnvironmentDirectory, "runtime.env"),
      join(symlinkedEnvironmentDirectory, "release.env"),
    ]);
    assert.notEqual(symlinkedParent.status, 0);
    assert.match(symlinkedParent.stderr, /symbolic link/u);

    writeFileSync(
      releaseEnvironment,
      `${validReleaseEnvironment()}LOGTO_APP_SECRET=${secret}\n`,
      { mode: 0o600 },
    );
    const leakedSecret = runScript("scripts/validate-production-host.sh", [
      runtimeEnvironment,
      releaseEnvironment,
    ]);
    assert.notEqual(leakedSecret.status, 0);
    assert.match(leakedSecret.stderr, /unsupported key/u);
    assert.equal(leakedSecret.stderr.includes(secret), false);
    writeFileSync(releaseEnvironment, validReleaseEnvironment(), { mode: 0o600 });

    writeFileSync(
      releaseEnvironment,
      validReleaseEnvironment().replace(
        `PLATFORM_MIGRATION_IMAGE_DIGEST=${"b".repeat(64)}`,
        `PLATFORM_MIGRATION_IMAGE_DIGEST=${"d".repeat(64)}`,
      ),
      { mode: 0o600 },
    );
    const rollbackRelease = runScript(
      "scripts/validate-production-host.sh",
      [runtimeEnvironment, releaseEnvironment],
      { PATH: `${fakeBin}:${process.env.PATH}` },
    );
    assert.equal(rollbackRelease.status, 0, rollbackRelease.stderr);
    writeFileSync(releaseEnvironment, validReleaseEnvironment(), { mode: 0o600 });

    chmodSync(runtimeEnvironment, 0o644);
    const unsafeMode = runScript("scripts/validate-production-host.sh", [
      runtimeEnvironment,
      releaseEnvironment,
    ]);
    assert.notEqual(unsafeMode.status, 0);
    assert.match(unsafeMode.stderr, /0600/u);

    chmodSync(runtimeEnvironment, 0o600);
    writeFileSync(runtimeEnvironment, "POSTGRES_PASSWORD=replace-with-a-secret\n", {
      mode: 0o600,
    });
    const placeholder = runScript("scripts/validate-production-host.sh", [
      runtimeEnvironment,
      releaseEnvironment,
    ]);
    assert.notEqual(placeholder.status, 0);
    assert.match(placeholder.stderr, /placeholder|missing/u);
    assert.equal(placeholder.stderr.includes("replace-with-a-secret"), false);
  } finally {
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});

function runScript(script, arguments_, environment = {}) {
  return spawnSync("bash", [resolve(repositoryRoot, script), ...arguments_], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: { ...process.env, ...environment },
  });
}

function modeOf(path) {
  return (statSync(path).mode & 0o777).toString(8).padStart(4, "0");
}

function validRuntimeEnvironment(secret) {
  return `PLATFORM_COMPOSE_PROJECT=inside-platform-production
PLATFORM_DOMAIN=inside.test
POSTGRES_DB=inside
POSTGRES_USER=inside_admin
POSTGRES_PASSWORD=${secret}
MIGRATION_DATABASE_USER=inside_migrator
MIGRATION_DATABASE_PASSWORD=${secret}
APPLICATION_DATABASE_USER=inside_app
APPLICATION_DATABASE_PASSWORD=${secret}
MIGRATION_DATABASE_URL=postgresql://inside_migrator:${secret}@postgres:5432/inside
DATABASE_URL=postgresql://inside_app:${secret}@postgres:5432/inside
LOGTO_ISSUER=https://identity.test/oidc
LOGTO_ENDPOINT=https://identity.test
LOGTO_AUDIENCE=https://api.inside.test
LOGTO_JWKS_URL=https://identity.test/oidc/jwks
LOGTO_APP_ID=inside-production
LOGTO_APP_SECRET=${secret}
LOGTO_COOKIE_SECRET=${secret}-at-least-32-random-characters
IDENTITY_EMAIL_FINGERPRINT_KEY=${secret}-at-least-32-random-characters
MEMBERSHIP_ACQUISITION_URL=https://membership.test
TELEGRAM_BOT_START_URL=https://t.me/inside_test_bot
TELEGRAM_LINKING_ENDPOINT=https://telegram.test/integrations/platform/v1/identity-links
TELEGRAM_LINKING_SECRET=${secret}
TELEGRAM_EVIDENCE_INGRESS_SECRET=${secret}
TELEGRAM_LINK_LIFETIME_SECONDS=300
OBJECT_STORAGE_ENDPOINT=https://storage.inside.test
OBJECT_STORAGE_REGION=ru-central1
OBJECT_STORAGE_ACCESS_KEY_ID=${secret}
OBJECT_STORAGE_SECRET_ACCESS_KEY=${secret}
OBJECT_STORAGE_PUBLIC_BUCKET=inside-production-public
OBJECT_STORAGE_PROTECTED_BUCKET=inside-production-protected
OBJECT_STORAGE_QUARANTINE_BUCKET=inside-production-quarantine
OBJECT_STORAGE_SIGNED_GET_TTL_SECONDS=60
MATERIAL_ASSET_ORPHAN_GRACE_SECONDS=86400
WEB_BASE_URL=https://inside.test
`;
}

function validReleaseEnvironment() {
  return `SOURCE_REVISION=${"a".repeat(40)}
PLATFORM_API_IMAGE_REPOSITORY=ghcr.io/sachkov-inside/platform-api
PLATFORM_API_IMAGE_DIGEST=${"b".repeat(64)}
PLATFORM_MIGRATION_IMAGE_REPOSITORY=ghcr.io/sachkov-inside/platform-api
PLATFORM_MIGRATION_IMAGE_DIGEST=${"b".repeat(64)}
PLATFORM_WEB_IMAGE_REPOSITORY=ghcr.io/sachkov-inside/platform-web
PLATFORM_WEB_IMAGE_DIGEST=${"c".repeat(64)}
`;
}

function fakeDockerScript(argumentsPath) {
  return `#!/usr/bin/env bash
set -euo pipefail
{
  printf 'COMPOSE_PROJECT_NAME=%s\\n' "\${COMPOSE_PROJECT_NAME-<unset>}"
  printf 'PLATFORM_HTTP_PORT=%s\\n' "\${PLATFORM_HTTP_PORT-<unset>}"
  printf 'PLATFORM_HTTPS_PORT=%s\\n' "\${PLATFORM_HTTPS_PORT-<unset>}"
  printf '%s\\n' "$@"
} > ${shellQuote(argumentsPath)}
`;
}

function shellQuote(value) {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
