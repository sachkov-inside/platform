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
  initialization: read(
    "infra/production/database/init-production-databases.sh",
  ),
  logtoCompose: read("infra/production/logto/compose.yaml"),
  pgbackrestConfig: read("infra/production/database/pgbackrest.conf"),
  postgresEnv: read("config/production/foundation/postgres.env.example"),
  restoreEntrypoint: read("infra/production/database/restore-entrypoint.sh"),
};

const hostLogs = {
  daemon: JSON.parse(read("infra/production/host/docker-daemon.json")),
  composeFiles: {
    "compose.production.yaml": read("compose.production.yaml"),
    "infra/production/database/compose.yaml": foundation.databaseCompose,
    "infra/production/logto/compose.yaml": foundation.logtoCompose,
  },
};

describe("production foundation architecture contract", () => {
  it("pulls Docker Hub images through the public mirror configured by provisioning", () => {
    assert.deepEqual(hostLogs.daemon["registry-mirrors"], [
      "https://mirror.gcr.io",
    ]);
    assert.match(
      read("infra/production/host/provision-host.sh"),
      /install -m 644 "\$script_dir\/docker-daemon\.json" \/etc\/docker\/daemon\.json/u,
    );
  });

  it("caps the log of every production container through the host Docker default", () => {
    assertContainerLogRotation(hostLogs);
  });

  it("rejects a host Docker default that lets container logs grow without a limit", () => {
    const { "log-opts": _rotation, ...unbounded } = hostLogs.daemon;

    assert.throws(
      () => assertContainerLogRotation({ ...hostLogs, daemon: unbounded }),
      /rotate container logs/u,
    );
  });

  it("rejects a production service that replaces the host log default", () => {
    const composeFiles = {
      ...hostLogs.composeFiles,
      "compose.production.yaml": hostLogs.composeFiles[
        "compose.production.yaml"
      ].replace("  api:\n", "  api:\n    logging:\n      driver: json-file\n"),
    };

    assert.throws(
      () => assertContainerLogRotation({ ...hostLogs, composeFiles }),
      /compose\.production\.yaml must keep the host log default/u,
    );
  });

  it("names the production Logto build with the current fork revision", () => {
    const { logto } = JSON.parse(read("infra/identity/logto/versions.json"));
    const image = foundation.logtoCompose.match(/^ {2}image: (.+)$/mu)?.[1];
    assert.equal(
      image,
      `inside/logto-production:${logto.version}-${logto.forkRevision}`,
    );
  });

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
    assert.match(
      foundation.initialization,
      /CREATE ROLE platform LOGIN PASSWORD/u,
    );
    assert.match(
      foundation.initialization,
      /CREATE DATABASE inside OWNER platform/u,
    );
    assert.doesNotMatch(
      `${foundation.postgresEnv}\n${foundation.initialization}`,
      /platform_(?:owner|runtime)|PLATFORM_DATABASE_(?:OWNER|RUNTIME)/u,
    );
  });

  it("rejects PostgreSQL running as PID 1 with asynchronous pgBackRest children", () => {
    assert.throws(
      () =>
        assertFoundationContract({
          ...foundation,
          databaseCompose: foundation.databaseCompose.replace(
            "    init: true\n",
            "",
          ),
        }),
      /PostgreSQL must delegate orphaned pgBackRest children to Docker init/u,
    );
  });
});

// Docker fixes the log options when it creates a container, so one host default covers Platform,
// foundation and Telegram containers alike; a service-level `logging` would silently opt out.
function assertContainerLogRotation({ daemon, composeFiles }) {
  assert.equal(
    daemon["log-driver"],
    "json-file",
    "rotate container logs with the json-file driver",
  );
  assert.deepEqual(
    daemon["log-opts"],
    { "max-size": "20m", "max-file": "5" },
    "rotate container logs at 20 MB and keep five files per container",
  );
  for (const [path, compose] of Object.entries(composeFiles)) {
    assert.doesNotMatch(
      compose,
      /^\s+logging:/mu,
      `${path} must keep the host log default`,
    );
  }
}

function assertFoundationContract(files) {
  assert.match(
    files.databaseCompose,
    /\n {2}postgres:\n(?: {4}[^\n]*\n)*? {4}init: true\n/u,
    "PostgreSQL must delegate orphaned pgBackRest children to Docker init",
  );
  const databaseNetwork = networkVariable(files.databaseCompose);
  const logtoNetwork = networkVariable(files.logtoCompose);
  if (databaseNetwork !== logtoNetwork) {
    throw new Error(
      "stacks must consume the same named internal database network",
    );
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
  assert.equal(
    restoreVolume,
    dataVolume,
    "restore must target the active data volume",
  );

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
    throw new Error(
      "restore must guard a recovery-prefixed volume before deleting data",
    );
  }

  assert.match(
    files.dockerfile,
    /^ENV INSIDE_POSTGRES_DATA_PATH=\/var\/lib\/postgresql\/18\/docker$/mu,
  );
  assert.match(
    files.dockerfile,
    /^ENV PGDATA=\$\{INSIDE_POSTGRES_DATA_PATH\}$/mu,
  );
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
