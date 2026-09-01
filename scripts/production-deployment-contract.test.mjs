import assert from "node:assert/strict";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const oldRevision = "a".repeat(40);
const candidateRevision = "b".repeat(40);
const failedRevision = "c".repeat(40);
const olderRevision = "d".repeat(40);

test("deployment promotes release pointers only after migrations, health and HTTPS smoke", () => {
  const fixture = createDeploymentFixture();

  try {
    createRelease(fixture, oldRevision, "a", "a", "e");
    createRelease(fixture, candidateRevision, "b", "b", "f");
    createRelease(fixture, failedRevision, "c", "c", "1");
    mkdirSync(join(fixture.installRoot, "releases", olderRevision));
    createReleaseState(fixture, oldRevision, olderRevision);

    const deployed = runReleaseScript(fixture, candidateRevision, "deploy-production-release.sh", [
      fixture.installRoot,
      candidateRevision,
      "200",
    ]);
    assert.equal(deployed.status, 0, deployed.stderr);
    assert.equal(deployed.stdout.includes(fixture.secret), false);
    assert.equal(deployed.stderr.includes(fixture.secret), false);
    assertReleaseState(fixture, candidateRevision, oldRevision);

    const commands = readFileSync(fixture.commandLog, "utf8");
    assert.ok(commands.indexOf("run --rm --no-deps migrations") >= 0, commands);
    assert.ok(commands.indexOf("up --detach --wait --no-deps api") >= 0, commands);
    assert.ok(
      commands.indexOf("run --rm --no-deps migrations") <
        commands.indexOf("up --detach --wait --no-deps api"),
      commands,
    );

    writeFileSync(join(fixture.stateRoot, "fail-curl-revision"), `${failedRevision}\n`);
    const failed = runReleaseScript(fixture, failedRevision, "deploy-production-release.sh", [
      fixture.installRoot,
      failedRevision,
      "300",
    ]);
    assert.notEqual(failed.status, 0);
    assertReleaseState(fixture, candidateRevision, oldRevision);

    const rolledBack = runReleaseScript(
      fixture,
      candidateRevision,
      "rollback-production-release.sh",
      [fixture.installRoot, "--acknowledge-forward-schema-compatible"],
    );
    assert.equal(rolledBack.status, 0, rolledBack.stderr);
    assertReleaseState(fixture, oldRevision, candidateRevision);
    assert.match(
      readFileSync(join(fixture.installRoot, "shared", "latest-migration.env"), "utf8"),
      new RegExp(`PLATFORM_MIGRATION_IMAGE_DIGEST=${"c".repeat(64)}`, "u"),
    );
  } finally {
    rmSync(fixture.temporaryRoot, { force: true, recursive: true });
  }
});

test("rollback requires compatibility acknowledgement and keeps the newest migration digest", () => {
  const fixture = createDeploymentFixture();

  try {
    createRelease(fixture, oldRevision, "a", "a", "e");
    createRelease(fixture, candidateRevision, "b", "b", "f");
    createReleaseState(fixture, candidateRevision, oldRevision);
    writeLatestMigrationState(fixture, "b");

    const outsideEnvironment = join(fixture.temporaryRoot, "outside-release.env");
    cpSync(
      join(fixture.installRoot, "releases", candidateRevision, "release.env"),
      outsideEnvironment,
    );
    const rejectedEnvironment = runReleaseScript(
      fixture,
      candidateRevision,
      "deploy-production-release.sh",
      [fixture.installRoot, candidateRevision, "rollback", outsideEnvironment],
    );
    assert.notEqual(rejectedEnvironment.status, 0);
    assert.match(rejectedEnvironment.stderr, /Rollback release environment path is invalid/u);
    assert.equal(existsSync(fixture.commandLog), false);

    const unacknowledged = runReleaseScript(
      fixture,
      candidateRevision,
      "rollback-production-release.sh",
      [fixture.installRoot],
    );
    assert.notEqual(unacknowledged.status, 0);
    assert.match(unacknowledged.stderr, /acknowledge-forward-schema-compatible/u);
    assertReleaseState(fixture, candidateRevision, oldRevision);

    const aliasedRoot = runReleaseScript(
      fixture,
      candidateRevision,
      "rollback-production-release.sh",
      [
        `${fixture.installRoot}/releases/..`,
        "--acknowledge-forward-schema-compatible",
      ],
    );
    assert.notEqual(aliasedRoot.status, 0);
    assert.match(aliasedRoot.stderr, /canonical/u);
    assertReleaseState(fixture, candidateRevision, oldRevision);

    const rolledBack = runReleaseScript(
      fixture,
      candidateRevision,
      "rollback-production-release.sh",
      [fixture.installRoot, "--acknowledge-forward-schema-compatible"],
    );
    assert.equal(rolledBack.status, 0, rolledBack.stderr);
    assertReleaseState(fixture, oldRevision, candidateRevision);

    const rollbackEnvironment = readFileSync(
      join(fixture.installRoot, "releases", oldRevision, "release.env"),
      "utf8",
    );
    assert.match(rollbackEnvironment, new RegExp(`PLATFORM_API_IMAGE_DIGEST=${"a".repeat(64)}`, "u"));
    assert.match(rollbackEnvironment, new RegExp(`PLATFORM_MIGRATION_IMAGE_DIGEST=${"a".repeat(64)}`, "u"));
    assert.match(
      readFileSync(join(fixture.installRoot, "shared", "latest-migration.env"), "utf8"),
      new RegExp(`PLATFORM_MIGRATION_IMAGE_DIGEST=${"b".repeat(64)}`, "u"),
    );
  } finally {
    rmSync(fixture.temporaryRoot, { force: true, recursive: true });
  }
});

test("migration intent survives a migration-command failure and governs rollback", () => {
  const fixture = createDeploymentFixture();

  try {
    createRelease(fixture, oldRevision, "a", "a", "e");
    createRelease(fixture, candidateRevision, "b", "b", "f");
    createRelease(fixture, failedRevision, "c", "c", "1");
    createReleaseState(fixture, candidateRevision, oldRevision);
    writeLatestMigrationState(fixture, "b");
    writeFileSync(join(fixture.stateRoot, "fail-migration-revision"), `${failedRevision}\n`);

    const failed = runReleaseScript(fixture, failedRevision, "deploy-production-release.sh", [
      fixture.installRoot,
      failedRevision,
      "950",
    ]);
    assert.notEqual(failed.status, 0);
    assertReleaseState(fixture, candidateRevision, oldRevision);
    assert.match(
      readFileSync(join(fixture.installRoot, "shared", "latest-migration.env"), "utf8"),
      new RegExp(`PLATFORM_MIGRATION_IMAGE_DIGEST=${"c".repeat(64)}`, "u"),
    );
    const failedCommands = readFileSync(fixture.commandLog, "utf8");
    assert.doesNotMatch(failedCommands, /up --detach --wait --no-deps api/u);

    rmSync(join(fixture.stateRoot, "fail-migration-revision"));
    const rolledBack = runReleaseScript(
      fixture,
      candidateRevision,
      "rollback-production-release.sh",
      [fixture.installRoot, "--acknowledge-forward-schema-compatible"],
    );
    assert.equal(rolledBack.status, 0, rolledBack.stderr);
    assertReleaseState(fixture, oldRevision, candidateRevision);
    assert.match(
      readFileSync(join(fixture.installRoot, "shared", "latest-migration.env"), "utf8"),
      new RegExp(`PLATFORM_MIGRATION_IMAGE_DIGEST=${"c".repeat(64)}`, "u"),
    );
  } finally {
    rmSync(fixture.temporaryRoot, { force: true, recursive: true });
  }
});

test("deployment rejects stale workflow runs and hostile ambient Compose values", () => {
  const fixture = createDeploymentFixture();

  try {
    createRelease(fixture, oldRevision, "a", "a", "e");
    createRelease(fixture, candidateRevision, "b", "b", "f");
    mkdirSync(join(fixture.installRoot, "releases", olderRevision));
    createRelease(fixture, failedRevision, "c", "c", "1");
    createReleaseState(fixture, oldRevision);

    const deployed = runReleaseScript(
      fixture,
      candidateRevision,
      "deploy-production-release.sh",
      [fixture.installRoot, candidateRevision, "900"],
      {
        COMPOSE_PROJECT_NAME: "hostile-project",
        PLATFORM_API_IMAGE_DIGEST: "9".repeat(64),
        PLATFORM_COMPOSE_PROJECT: "hostile-platform",
        SOURCE_REVISION: failedRevision,
      },
    );
    assert.equal(deployed.status, 0, deployed.stderr);
    assertReleaseState(fixture, candidateRevision, oldRevision);
    const commandsAfterDeploy = readFileSync(fixture.commandLog, "utf8");
    assert.match(commandsAfterDeploy, new RegExp(`pull-api-digest=${"b".repeat(64)}`, "u"));
    assert.doesNotMatch(commandsAfterDeploy, /hostile-project|hostile-platform/u);
    assert.doesNotMatch(commandsAfterDeploy, new RegExp(`pull-api-digest=${"9".repeat(64)}`, "u"));

    const stale = runReleaseScript(fixture, failedRevision, "deploy-production-release.sh", [
      fixture.installRoot,
      failedRevision,
      "899",
    ]);
    assert.notEqual(stale.status, 0);
    assert.match(stale.stderr, /stale workflow run/u);
    assertReleaseState(fixture, candidateRevision, oldRevision);
  } finally {
    rmSync(fixture.temporaryRoot, { force: true, recursive: true });
  }
});

test("release state switch is atomic when the final rename fails", () => {
  const fixture = createDeploymentFixture();

  try {
    createRelease(fixture, oldRevision, "a", "a", "e");
    createRelease(fixture, candidateRevision, "b", "b", "f");
    mkdirSync(join(fixture.installRoot, "releases", olderRevision));
    createReleaseState(fixture, oldRevision, olderRevision);
    writeFileSync(join(fixture.stateRoot, "fail-state-switch"), "fail\n");

    const failed = runReleaseScript(fixture, candidateRevision, "deploy-production-release.sh", [
      fixture.installRoot,
      candidateRevision,
      "500",
    ]);
    assert.notEqual(failed.status, 0);
    assertReleaseState(fixture, oldRevision, olderRevision);
  } finally {
    rmSync(fixture.temporaryRoot, { force: true, recursive: true });
  }
});

test("first release state creation recovers after a selector-switch failure", () => {
  const fixture = createDeploymentFixture();

  try {
    createRelease(fixture, candidateRevision, "b", "b", "f");
    writeFileSync(join(fixture.stateRoot, "fail-state-switch"), "fail\n");

    const failed = runReleaseScript(fixture, candidateRevision, "deploy-production-release.sh", [
      fixture.installRoot,
      candidateRevision,
      "700",
    ]);
    assert.notEqual(failed.status, 0);
    assert.equal(existsSync(join(fixture.installRoot, "release-state")), false);
    assert.equal(readlinkSync(join(fixture.installRoot, "current")), "release-state/current");
    assert.equal(readlinkSync(join(fixture.installRoot, "previous")), "release-state/previous");
    assert.equal(existsSync(join(fixture.installRoot, "current")), false);
    assert.equal(existsSync(join(fixture.installRoot, "previous")), false);

    rmSync(join(fixture.stateRoot, "fail-state-switch"));
    const retried = runReleaseScript(fixture, candidateRevision, "deploy-production-release.sh", [
      fixture.installRoot,
      candidateRevision,
      "700",
    ]);
    assert.equal(retried.status, 0, retried.stderr);
    assertReleaseState(fixture, candidateRevision);
  } finally {
    rmSync(fixture.temporaryRoot, { force: true, recursive: true });
  }
});

test("the production lock serializes two real processes", async () => {
  const fixture = createDeploymentFixture();
  const worker = join(fixture.temporaryRoot, "lock-worker.sh");
  const lockLog = join(fixture.stateRoot, "lock.log");

  try {
    writeFileSync(
      worker,
      `#!/usr/bin/env bash\nset -euo pipefail\nprintf '%s-start\\n' "$1" >> ${shellQuote(lockLog)}\nsleep 0.2\nprintf '%s-end\\n' "$1" >> ${shellQuote(lockLog)}\n`,
      { mode: 0o755 },
    );
    const wrapper = join(repositoryRoot, "scripts", "run-with-production-deploy-lock.sh");
    const results = await Promise.all([
      runProcess("bash", [wrapper, fixture.installRoot, "bash", worker, "one"]),
      runProcess("bash", [wrapper, fixture.installRoot, "bash", worker, "two"]),
    ]);
    for (const result of results) {
      assert.equal(result.status, 0, result.stderr);
    }
    const entries = readFileSync(lockLog, "utf8").trim().split("\n");
    assert.deepEqual(
      entries,
      entries[0] === "one-start"
        ? ["one-start", "one-end", "two-start", "two-end"]
        : ["two-start", "two-end", "one-start", "one-end"],
    );
  } finally {
    rmSync(fixture.temporaryRoot, { force: true, recursive: true });
  }
});

test("runner transport sends only the release bundle over pinned SSH trust", () => {
  const temporaryRoot = mkdtempSync(join(realpathSync(tmpdir()), "inside-platform-transport-"));
  const fakeBin = join(temporaryRoot, "bin");
  const commandLog = join(temporaryRoot, "transport.log");
  const privateKey = join(temporaryRoot, "deploy-key");
  const knownHosts = join(temporaryRoot, "known-hosts");
  const privateKeyValue = "private-key-never-print";

  try {
    mkdirSync(fakeBin);
    writeFileSync(privateKey, privateKeyValue, { mode: 0o600 });
    writeFileSync(knownHosts, "deploy.inside.test ssh-ed25519 AAAATEST\n", { mode: 0o600 });
    writeFileSync(join(fakeBin, "ssh"), fakeSshScript(commandLog), { mode: 0o755 });
    writeFileSync(join(fakeBin, "scp"), fakeScpScript(commandLog), { mode: 0o755 });

    const transported = spawnSync(
      "bash",
      [
        join(repositoryRoot, "scripts", "deploy-production-over-ssh.sh"),
        "/opt/sachkov-inside/platform",
        candidateRevision,
        `sha256:${"b".repeat(64)}`,
        `sha256:${"f".repeat(64)}`,
        "deploy.inside.test",
        "inside_deploy",
        privateKey,
        knownHosts,
      ],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${fakeBin}:${process.env.PATH}`,
          PLATFORM_DEPLOY_ATTEMPT: "12345-2",
        },
      },
    );
    assert.equal(transported.status, 0, transported.stderr);
    assert.equal(transported.stdout.includes(privateKeyValue), false);
    assert.equal(transported.stderr.includes(privateKeyValue), false);

    const transportLog = readFileSync(commandLog, "utf8");
    assert.match(transportLog, /StrictHostKeyChecking=yes/u);
    assert.match(transportLog, /BatchMode=yes/u);
    assert.match(transportLog, /inside_deploy@deploy\.inside\.test/u);
    assert.doesNotMatch(transportLog, /ssh-keyscan/u);
    assert.match(
      transportLog,
      /BUNDLE Caddyfile,compose\.production\.yaml,release\.env,scripts\/deploy-production-release\.sh,scripts\/install-production-release\.sh,scripts\/production-deployment-state\.sh,scripts\/production-path-contract\.sh,scripts\/provision-production-database-roles\.sh,scripts\/rollback-production-release\.sh,scripts\/run-with-production-deploy-lock\.sh,scripts\/validate-production-host\.sh/u,
    );
    assert.match(transportLog, new RegExp(`SOURCE_REVISION=${candidateRevision}`, "u"));
    assert.match(
      transportLog,
      new RegExp(`PLATFORM_MIGRATION_IMAGE_DIGEST=${"b".repeat(64)}`, "u"),
    );

    const aliasedRoot = spawnSync(
      "bash",
      [
        join(repositoryRoot, "scripts", "deploy-production-over-ssh.sh"),
        "/opt/sachkov-inside/platform/releases/..",
        candidateRevision,
        `sha256:${"b".repeat(64)}`,
        `sha256:${"f".repeat(64)}`,
        "deploy.inside.test",
        "inside_deploy",
        privateKey,
        knownHosts,
      ],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${fakeBin}:${process.env.PATH}`,
          PLATFORM_DEPLOY_ATTEMPT: "12345-3",
        },
      },
    );
    assert.notEqual(aliasedRoot.status, 0);
    assert.match(aliasedRoot.stderr, /canonical/u);
  } finally {
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});

test("server installer commits only an allowlisted release bundle", () => {
  const fixture = createDeploymentFixture();
  const staging = join(
    fixture.installRoot,
    "releases",
    `.incoming-${candidateRevision}-12345-1`,
  );

  try {
    createRelease(fixture, candidateRevision, "b", "b", "f", staging);
    const installed = spawnSync(
      "bash",
      [
        join(staging, "scripts", "install-production-release.sh"),
        fixture.installRoot,
        candidateRevision,
        staging,
      ],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
        env: { ...process.env, PATH: `${fixture.fakeBin}:${process.env.PATH}` },
      },
    );
    assert.equal(installed.status, 0, installed.stderr);
    assert.equal(existsSync(staging), false);
    assertReleaseState(fixture, candidateRevision);

    const unsupportedStaging = join(
      fixture.installRoot,
      "releases",
      `.incoming-${failedRevision}-12345-2`,
    );
    createRelease(fixture, failedRevision, "c", "c", "1", unsupportedStaging);
    writeFileSync(join(unsupportedStaging, "unexpected-secret.env"), "must-not-transfer=true\n");
    const unsupported = spawnSync(
      "bash",
      [
        join(unsupportedStaging, "scripts", "install-production-release.sh"),
        fixture.installRoot,
        failedRevision,
        unsupportedStaging,
      ],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
        env: { ...process.env, PATH: `${fixture.fakeBin}:${process.env.PATH}` },
      },
    );
    assert.notEqual(unsupported.status, 0);
    assert.match(unsupported.stderr, /unsupported entries/u);
    assertReleaseState(fixture, candidateRevision);
  } finally {
    rmSync(fixture.temporaryRoot, { force: true, recursive: true });
  }
});

function createDeploymentFixture() {
  const temporaryRoot = mkdtempSync(join(realpathSync(tmpdir()), "inside-platform-deployment-"));
  const installRoot = join(temporaryRoot, "platform");
  const stateRoot = join(temporaryRoot, "state");
  const fakeBin = join(temporaryRoot, "bin");
  const commandLog = join(stateRoot, "commands.log");
  const secret = "server-only-secret-never-print";

  mkdirSync(join(installRoot, "shared"), { mode: 0o700, recursive: true });
  mkdirSync(join(installRoot, "releases"), { mode: 0o750 });
  mkdirSync(stateRoot);
  mkdirSync(fakeBin);
  writeFileSync(
    join(installRoot, "shared", "runtime.env"),
    `PLATFORM_DOMAIN=inside.test\nSERVER_ONLY_SECRET=${secret}\n`,
    { mode: 0o600 },
  );
  writeFileSync(join(fakeBin, "docker"), fakeDockerScript(stateRoot, commandLog), { mode: 0o755 });
  writeFileSync(join(fakeBin, "curl"), fakeCurlScript(stateRoot, commandLog), { mode: 0o755 });
  writeFileSync(join(fakeBin, "python3"), fakePythonScript(stateRoot), { mode: 0o755 });

  return { commandLog, fakeBin, installRoot, secret, stateRoot, temporaryRoot };
}

function createRelease(
  fixture,
  revision,
  apiDigestCharacter,
  migrationDigestCharacter,
  webDigestCharacter,
  releaseRoot = join(fixture.installRoot, "releases", revision),
) {
  const scriptsRoot = join(releaseRoot, "scripts");
  mkdirSync(scriptsRoot, { recursive: true });
  writeFileSync(join(releaseRoot, "compose.production.yaml"), "services: {}\n");
  writeFileSync(join(releaseRoot, "Caddyfile"), "{$PLATFORM_DOMAIN} { respond ok }\n");
  writeFileSync(
    join(releaseRoot, "release.env"),
    releaseEnvironment(revision, apiDigestCharacter, migrationDigestCharacter, webDigestCharacter),
    { mode: 0o640 },
  );
  writeFileSync(
    join(scriptsRoot, "validate-production-host.sh"),
    `#!/usr/bin/env bash\nset -euo pipefail\nprintf 'validate %s %s\\n' "$1" "$2" >> ${shellQuote(fixture.commandLog)}\n`,
    { mode: 0o755 },
  );
  for (const script of [
    "deploy-production-release.sh",
    "install-production-release.sh",
    "production-deployment-state.sh",
    "production-path-contract.sh",
    "provision-production-database-roles.sh",
    "rollback-production-release.sh",
    "run-with-production-deploy-lock.sh",
  ]) {
    const source = join(repositoryRoot, "scripts", script);
    assert.equal(existsSync(source), true, `${script} must exist`);
    cpSync(source, join(scriptsRoot, script));
    chmodSync(join(scriptsRoot, script), 0o755);
  }
}

function runReleaseScript(fixture, releaseRevision, script, arguments_, environment = {}) {
  return spawnSync(
    "bash",
    [join(fixture.installRoot, "releases", releaseRevision, "scripts", script), ...arguments_],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: { ...process.env, ...environment, PATH: `${fixture.fakeBin}:${process.env.PATH}` },
    },
  );
}

function releaseEnvironment(revision, api, migration, web) {
  return `SOURCE_REVISION=${revision}
PLATFORM_API_IMAGE_REPOSITORY=ghcr.io/sachkov-inside/platform-api
PLATFORM_API_IMAGE_DIGEST=${api.repeat(64)}
PLATFORM_MIGRATION_IMAGE_REPOSITORY=ghcr.io/sachkov-inside/platform-api
PLATFORM_MIGRATION_IMAGE_DIGEST=${migration.repeat(64)}
PLATFORM_WEB_IMAGE_REPOSITORY=ghcr.io/sachkov-inside/platform-web
PLATFORM_WEB_IMAGE_DIGEST=${web.repeat(64)}
`;
}

function fakeDockerScript(stateRoot, commandLog) {
  return `#!/usr/bin/env bash
set -euo pipefail
printf 'docker %s\\n' "$*" >> ${shellQuote(commandLog)}
if [[ "\${1:-}" == "inspect" ]]; then
  cat ${shellQuote(join(stateRoot, "revision"))}
  exit 0
fi
release_environment=""
previous=""
for argument in "$@"; do
  if [[ "$previous" == "--env-file" ]]; then
    release_environment="$argument"
  fi
  previous="$argument"
done
if [[ "$*" == *" pull" ]]; then
  api_digest="\${PLATFORM_API_IMAGE_DIGEST:-$(grep '^PLATFORM_API_IMAGE_DIGEST=' "$release_environment" | cut -d= -f2-)}"
  printf 'pull-api-digest=%s compose-project=%s platform-project=%s\\n' \
    "$api_digest" \
    "\${COMPOSE_PROJECT_NAME:-}" \
    "\${PLATFORM_COMPOSE_PROJECT:-}" >> ${shellQuote(commandLog)}
  grep '^SOURCE_REVISION=' "$release_environment" | cut -d= -f2- > ${shellQuote(join(stateRoot, "revision"))}
fi
if [[ "$*" == *"run --rm --no-deps migrations"* ]] && \
   [[ -e ${shellQuote(join(stateRoot, "fail-migration-revision"))} ]] && \
   [[ "$(cat ${shellQuote(join(stateRoot, "fail-migration-revision"))})" == "$(cat ${shellQuote(join(stateRoot, "revision"))})" ]]; then
  exit 75
fi
if [[ "$*" == *" ps --quiet api"* ]]; then
  printf 'api-container\\n'
fi
if [[ "$*" == *" ps --quiet web"* ]]; then
  printf 'web-container\\n'
fi
if [[ "$*" == *" exec -T api node"* ]]; then
  printf '{"process":"api","status":"ok","database":"reachable"}'
fi
`;
}

function fakeCurlScript(stateRoot, commandLog) {
  return `#!/usr/bin/env bash
set -euo pipefail
printf 'curl %s\\n' "$*" >> ${shellQuote(commandLog)}
if [[ -e ${shellQuote(join(stateRoot, "fail-curl-revision"))} ]] && \
   [[ "$(cat ${shellQuote(join(stateRoot, "fail-curl-revision"))})" == "$(cat ${shellQuote(join(stateRoot, "revision"))})" ]]; then
  exit 22
fi
printf '<html>Sachkov Inside</html>'
`;
}

function fakePythonScript(stateRoot) {
  return `#!/usr/bin/env bash
set -euo pipefail
if [[ -e ${shellQuote(join(stateRoot, "fail-state-switch"))} ]]; then
  for argument in "$@"; do
    if [[ "$argument" == */release-state ]]; then
      printf 'injected release state switch failure\\n' >&2
      exit 70
    fi
  done
fi
exec /usr/bin/python3 "$@"
`;
}

function fakeSshScript(commandLog) {
  return `#!/usr/bin/env bash
set -euo pipefail
printf 'ssh %s\\n' "$*" >> ${shellQuote(commandLog)}
`;
}

function fakeScpScript(commandLog) {
  return `#!/usr/bin/env bash
set -euo pipefail
printf 'scp %s\\n' "$*" >> ${shellQuote(commandLog)}
source_path="\${@: -2:1}"
bundle_root="\${source_path%/.}"
bundle_files="$(find "$bundle_root" -type f | sed "s|^$bundle_root/||" | LC_ALL=C sort | paste -sd, -)"
printf 'BUNDLE %s\\n' "$bundle_files" >> ${shellQuote(commandLog)}
cat "$bundle_root/release.env" >> ${shellQuote(commandLog)}
`;
}

function shellQuote(value) {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function createReleaseState(fixture, currentRevision, previousRevision) {
  const statesRoot = join(fixture.installRoot, "shared", "release-states");
  const stateName = `.state.${currentRevision.slice(0, 8)}`;
  const stateRoot = join(statesRoot, stateName);
  mkdirSync(stateRoot, { recursive: true });
  symlinkSync(`../../../releases/${currentRevision}`, join(stateRoot, "current"));
  if (previousRevision !== undefined) {
    symlinkSync(`../../../releases/${previousRevision}`, join(stateRoot, "previous"));
  }
  symlinkSync(`shared/release-states/${stateName}`, join(fixture.installRoot, "release-state"));
  symlinkSync("release-state/current", join(fixture.installRoot, "current"));
  symlinkSync("release-state/previous", join(fixture.installRoot, "previous"));
}

function assertReleaseState(fixture, currentRevision, previousRevision) {
  assert.equal(readlinkSync(join(fixture.installRoot, "current")), "release-state/current");
  assert.equal(readlinkSync(join(fixture.installRoot, "previous")), "release-state/previous");
  assert.equal(
    realpathSync(join(fixture.installRoot, "current")),
    realpathSync(join(fixture.installRoot, "releases", currentRevision)),
  );
  if (previousRevision === undefined) {
    assert.equal(existsSync(join(fixture.installRoot, "previous")), false);
  } else {
    assert.equal(
      realpathSync(join(fixture.installRoot, "previous")),
      realpathSync(join(fixture.installRoot, "releases", previousRevision)),
    );
  }
}

function writeLatestMigrationState(fixture, digestCharacter) {
  writeFileSync(
    join(fixture.installRoot, "shared", "latest-migration.env"),
    `PLATFORM_MIGRATION_IMAGE_REPOSITORY=ghcr.io/sachkov-inside/platform-api\nPLATFORM_MIGRATION_IMAGE_DIGEST=${digestCharacter.repeat(64)}\n`,
    { mode: 0o600 },
  );
}

function runProcess(command, arguments_) {
  return new Promise((resolvePromise) => {
    const child = spawn(command, arguments_);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (status) => resolvePromise({ status, stderr, stdout }));
  });
}
