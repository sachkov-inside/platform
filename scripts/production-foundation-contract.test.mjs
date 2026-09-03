import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(repositoryRoot, path), "utf8");

const foundation = {
  databaseCompose: read("infra/production/database/compose.yaml"),
  databaseEnv: read("config/production/foundation/database.env.example"),
  dockerfile: read("infra/production/database/Dockerfile"),
  initialization: read("infra/production/database/init-production-databases.sh"),
  logtoCompose: read("infra/production/logto/compose.yaml"),
  pgbackrestConfig: read("infra/production/database/pgbackrest.conf"),
  postgresEnv: read("config/production/foundation/postgres.env.example"),
  restoreEntrypoint: read("infra/production/database/restore-entrypoint.sh"),
};

describe("production foundation architecture contract", () => {
  it("shares only the internal database network across the database and Logto stacks", () => {
    assertFoundationContract(foundation);
  });

  it("rejects a Logto stack wired to a different database network", () => {
    const mismatchedNetwork = {
      ...foundation,
      logtoCompose: foundation.logtoCompose.replaceAll(
        "FOUNDATION_DATABASE_NETWORK",
        "FOUNDATION_OTHER_NETWORK",
      ),
    };

    assert.throws(
      () => assertFoundationContract(mismatchedNetwork),
      /same named internal database network/u,
    );
  });

  it("rejects restore code that can wipe a volume without the recovery-name guard", () => {
    const unguardedRestore = {
      ...foundation,
      restoreEntrypoint: foundation.restoreEntrypoint.replace(
        /case "\$\{INSIDE_RESTORE_VOLUME:-\}" in[\s\S]*?esac\n/u,
        "",
      ),
    };

    assert.throws(
      () => assertFoundationContract(unguardedRestore),
      /guard a recovery-prefixed volume before deleting data/u,
    );
  });

  it("uses one shared non-superuser Platform role for migrations and runtime", () => {
    assert.match(foundation.postgresEnv, /^PLATFORM_DATABASE_PASSWORD=/mu);
    assert.match(foundation.initialization, /CREATE ROLE platform LOGIN PASSWORD/u);
    assert.match(foundation.initialization, /CREATE DATABASE inside OWNER platform/u);
    assert.doesNotMatch(
      `${foundation.postgresEnv}\n${foundation.initialization}`,
      /platform_(?:owner|runtime)|PLATFORM_DATABASE_(?:OWNER|RUNTIME)/u,
    );
  });
});

function assertFoundationContract(files) {
  const databaseNetwork = networkVariable(files.databaseCompose);
  const logtoNetwork = networkVariable(files.logtoCompose);
  if (databaseNetwork !== logtoNetwork) {
    throw new Error("stacks must consume the same named internal database network");
  }
  assert.match(
    files.databaseCompose,
    /database:\n {4}name: \$\{FOUNDATION_DATABASE_NETWORK:[^\n]+\}\n {4}internal: true/u,
  );
  assert.match(
    files.logtoCompose,
    /database:\n {4}external: true\n {4}name: \$\{FOUNDATION_DATABASE_NETWORK:[^\n]+\}/u,
  );

  const dataVolume = composeVariable(
    files.databaseCompose,
    /postgres-data:\n {4}name: \$\{([A-Z_]+):/u,
  );
  const restoreVolume = composeVariable(
    files.databaseCompose,
    /INSIDE_RESTORE_VOLUME: \$\{([A-Z_]+):/u,
  );
  assert.equal(restoreVolume, dataVolume, "restore must target the active data volume");

  const guard = files.restoreEntrypoint.indexOf(
    'case "${INSIDE_RESTORE_VOLUME:-}" in',
  );
  const recoveryPrefix = files.restoreEntrypoint.indexOf(
    "inside-production-postgres-data-recovery-",
  );
  const destructiveWrite = files.restoreEntrypoint.indexOf('find "$PGDATA"');
  if (
    guard === -1 ||
    recoveryPrefix < guard ||
    destructiveWrite < recoveryPrefix
  ) {
    throw new Error("restore must guard a recovery-prefixed volume before deleting data");
  }

  assert.match(
    files.dockerfile,
    /^ENV INSIDE_POSTGRES_DATA_PATH=\/var\/lib\/postgresql\/18\/docker$/mu,
  );
  assert.match(files.dockerfile, /^ENV PGDATA=\$\{INSIDE_POSTGRES_DATA_PATH\}$/mu);
  assert.match(
    files.dockerfile,
    /^ENV PGBACKREST_PG1_PATH=\$\{INSIDE_POSTGRES_DATA_PATH\}$/mu,
  );
  assert.doesNotMatch(files.databaseEnv, /^PGDATA=/mu);
  assert.doesNotMatch(files.pgbackrestConfig, /^pg1-path=/mu);
  assert.match(
    files.restoreEntrypoint,
    /"\$\{PGDATA:-\}" != "\$INSIDE_POSTGRES_DATA_PATH"/u,
  );
}

function networkVariable(compose) {
  return composeVariable(
    compose,
    /database:\n(?: {4}[^\n]+\n)*? {4}name: \$\{([A-Z_]+):/u,
  );
}

function composeVariable(compose, pattern) {
  const match = compose.match(pattern);
  assert.ok(match, `Compose source must match ${pattern}`);
  return match[1];
}
