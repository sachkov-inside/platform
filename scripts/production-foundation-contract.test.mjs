import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(repositoryRoot, path), "utf8");
const readJson = (path) => JSON.parse(read(path));

describe("production foundation contract", () => {
  it("pins one supported host shape and a non-interactive deploy identity", () => {
    const manifest = readJson("infra/production/host/foundation.json");
    const bootstrap = read("infra/production/host/host-foundation.py");
    const ssh = read("infra/production/host/inside-deploy.sshd.conf");
    const sudoers = read("infra/production/host/inside-deploy.sudoers");

    assert.deepEqual(manifest.host, {
      architecture: "x86_64",
      osId: "ubuntu",
      osVersion: "24.04",
    });
    assert.ok(manifest.capacity.minimumCpuCount >= 4);
    assert.ok(manifest.capacity.minimumMemoryBytes >= 8 * 1024 ** 3);
    assert.ok(manifest.capacity.minimumDiskBytes >= 80 * 1024 ** 3);
    assert.equal(manifest.identity.releaseRetention, 4);
    assert.match(manifest.runtime.node.version, /^24\./u);
    assert.match(ssh, /ForceCommand \/usr\/local\/libexec\/inside\/inside-deploy-command/u);
    assert.match(ssh, /PermitTTY no/u);
    assert.match(sudoers, /^inside-deploy .* NOPASSWD:/mu);
    assert.doesNotMatch(sudoers, /!authenticate/u);
    assert.doesNotMatch(bootstrap, /usermod[^\n]+docker/u);
  });

  it("keeps PostgreSQL private with separate Platform and Logto authorities", () => {
    const compose = read("infra/production/database/compose.yaml");
    const init = read("infra/production/database/init-production-databases.sh");

    assert.doesNotMatch(compose, /^\s+ports:/mu);
    assert.match(compose, /^\s+internal: true$/mu);
    assert.match(compose, /^ {2}backup-egress:$/mu);
    assert.match(init, /CREATE DATABASE inside OWNER platform_owner/u);
    assert.match(init, /CREATE DATABASE logto OWNER logto_owner/u);
    assert.match(init, /CREATE ROLE logto_owner LOGIN CREATEROLE/u);
    assert.doesNotMatch(init, /CREATE ROLE logto_owner[^\n]+SUPERUSER/u);
    assert.match(init, /GRANT CONNECT ON DATABASE inside TO platform_runtime/u);
  });

  it("enforces continuous encrypted backups and the bounded schedule", () => {
    const policy = readJson("infra/production/database/backup-policy.json");
    const pgBackRest = read("infra/production/database/pgbackrest.conf");

    assert.equal(policy.archiveMode, "continuous");
    assert.equal(policy.clientEncryption, "aes-256-cbc");
    assert.equal(policy.retentionFullBackups, 4);
    assert.deepEqual(policy.targets.databases, ["inside", "logto"]);
    assert.equal(policy.targets.rpoSeconds, 3600);
    assert.equal(policy.targets.rtoSeconds, 14_400);
    assert.equal(
      read("infra/production/database/inside-pgbackrest-full.timer").includes(
        `OnCalendar=${policy.schedule.full}`,
      ),
      true,
    );
    assert.equal(
      read("infra/production/database/inside-pgbackrest-diff.timer").includes(
        `OnCalendar=${policy.schedule.differential}`,
      ),
      true,
    );
    assert.equal(
      read("infra/production/database/inside-pgbackrest-incr.timer").includes(
        `OnCalendar=${policy.schedule.incremental}`,
      ),
      true,
    );
    assert.match(pgBackRest, /^archive-async=y$/mu);
    assert.match(pgBackRest, /^archive-timeout=60$/mu);
    assert.match(pgBackRest, /^repo1-cipher-type=aes-256-cbc$/mu);
    assert.match(pgBackRest, /^repo1-retention-full=4$/mu);
  });

  it("runs Logto as a separate long-lived stack without publishing its admin surface", () => {
    const compose = read("infra/production/logto/compose.yaml");

    assert.match(compose, /^ {2}logto-migrations:$/mu);
    assert.match(compose, /^ {2}logto:$/mu);
    assert.match(compose, /condition: service_completed_successfully/u);
    assert.match(
      compose,
      /127\.0\.0\.1:\$\{FOUNDATION_LOGTO_LOOPBACK_PORT:-3301\}:3001/u,
    );
    assert.match(compose, /^\s+external: true$/mu);
    assert.doesNotMatch(compose, /3002/u);
  });

  it("requires host and offline secret recipients plus separate asset and backup identities", () => {
    const policy = readJson("infra/production/secrets/secret-policy.json");
    const provider = readJson(
      "infra/production/config/provider-contract.example.json",
    );

    assert.equal(policy.minimumAgeRecipients, 2);
    assert.notEqual(
      provider.assets.accessKeyIdRef,
      provider.backups.accessKeyIdRef,
    );
    assert.notEqual(provider.assets.publicBucket, provider.backups.bucket);
    assert.notEqual(provider.assets.protectedBucket, provider.backups.bucket);
    assert.notEqual(provider.assets.quarantineBucket, provider.backups.bucket);
    assert.equal(provider.identity.issuer, "https://auth.sachkov.dev/oidc");
    assert.equal(provider.identity.callbackUrl, "https://inside.sachkov.dev/callback");
    assert.equal(provider.mcp.serverUrl, "https://inside.sachkov.dev/mcp");
  });
});
