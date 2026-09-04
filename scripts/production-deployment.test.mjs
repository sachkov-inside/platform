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

import { writeTrustedReleaseEvidence } from "./github-release-evidence.test-support.mjs";

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
      assert.match(
        firstExternalLog,
        /docker compose .* run --pull never --rm --no-deps migrations node dist\/migrations\/migrate\.js --verify-schema-compatible/u,
      );
      assert.ok(
        firstExternalLog.indexOf("caddy reload") <
          firstExternalLog.indexOf("docker pull"),
        "maintenance must be enabled before exact images are pulled",
      );
      assertGatewaySuccess(fixture, "deploy", "v1", 102);
      const noOpLog = readExternalLog(fixture).slice(firstExternalLog.length);
      assert.match(noOpLog, /--verify-schema-identity/u);
      assert.doesNotMatch(noOpLog, /docker pull|caddy reload| up --detach| run --rm migrations/u);

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

  for (const phase of [
    "preflight",
    "maintenance",
    "pull",
    "workers",
    "migrations",
    "start",
    "readiness",
    "smoke",
    "routes",
    "journal",
  ]) {
    it(`records ${phase} failure and safely repeats the same deployment`, () => {
      const fixture = createHostFixture();
      try {
        assertGatewaySuccess(fixture, "deploy", "v1", 200);
        const activeCaddy = resolve(
          fixture.root,
          "srv/inside/runtime/caddy/active.caddy",
        );
        const previousRoute = readFileSync(activeCaddy, "utf8");
        const failed = runGateway(fixture, "deploy", "v2", 201, {
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
        if (
          phase === "preflight" ||
          phase === "maintenance" ||
          phase === "journal"
        ) {
          assert.equal(readFileSync(activeCaddy, "utf8"), previousRoute);
        } else {
          assert.match(readFileSync(activeCaddy, "utf8"), /Deployment in progress/u);
        }

        assertGatewaySuccess(fixture, "deploy", "v2", 202);
        assert.equal(readState(fixture).current.version, "v2");
      } finally {
        fixture.cleanup();
      }
    });
  }

  it("rejects a database schema mismatch before enabling maintenance", () => {
    const fixture = createHostFixture();
    try {
      assertGatewaySuccess(fixture, "deploy", "v1", 203);
      const activeCaddy = resolve(
        fixture.root,
        "srv/inside/runtime/caddy/active.caddy",
      );
      const previousRoute = readFileSync(activeCaddy, "utf8");
      const failed = runGateway(fixture, "deploy", "v2", 204, {
        INSIDE_DEPLOY_TEST_SCHEMA_MISMATCH: "true",
      });

      assert.notEqual(failed.status, 0);
      assert.equal(
        JSON.parse(
          readFileSync(
            resolve(
              fixture.root,
              "var/lib/inside/deployments/operation.json",
            ),
            "utf8",
          ),
        ).phase,
        "preflight",
      );
      assert.equal(
        readFileSync(activeCaddy, "utf8"),
        previousRoute,
      );
    } finally {
      fixture.cleanup();
    }
  });

  it("rejects a non-empty first-deploy database before enabling maintenance", () => {
    const fixture = createHostFixture();
    try {
      const failed = runGateway(fixture, "deploy", "v1", 204, {
        INSIDE_DEPLOY_TEST_NONEMPTY_DATABASE: "true",
      });

      assert.notEqual(failed.status, 0);
      assert.match(failed.stderr, /requires an empty application database/u);
      assert.equal(
        existsSync(
          resolve(fixture.root, "srv/inside/runtime/caddy/active.caddy"),
        ),
        false,
      );
    } finally {
      fixture.cleanup();
    }
  });

  it("resumes a release whose migrations completed before a later failure", () => {
    const fixture = createHostFixture();
    try {
      assertGatewaySuccess(fixture, "deploy", "v1", 205);
      assert.notEqual(
        runGateway(fixture, "deploy", "v2", 206, {
          INSIDE_DEPLOY_FAIL_PHASE: "readiness",
        }).status,
        0,
      );

      assert.equal(
        runGateway(fixture, "deploy", "v2", 207, {
          INSIDE_DEPLOY_TEST_CURRENT_SCHEMA_MISMATCH: "true",
        }).status,
        0,
      );
      assert.equal(readState(fixture).current.version, "v2");
    } finally {
      fixture.cleanup();
    }
  });

  it("resumes the first deployment after migrations made the database non-empty", () => {
    const fixture = createHostFixture();
    try {
      assert.notEqual(
        runGateway(fixture, "deploy", "v1", 208, {
          INSIDE_DEPLOY_FAIL_PHASE: "readiness",
        }).status,
        0,
      );

      assert.equal(
        runGateway(fixture, "deploy", "v1", 209, {
          INSIDE_DEPLOY_TEST_NONEMPTY_DATABASE: "true",
        }).status,
        0,
      );
      assert.equal(readState(fixture).current.version, "v1");
    } finally {
      fixture.cleanup();
    }
  });

  it("resumes a first-deploy migration from a compatible partial ledger", () => {
    const fixture = createHostFixture();
    try {
      assert.notEqual(
        runGateway(fixture, "deploy", "v1", 210, {
          INSIDE_DEPLOY_FAIL_PHASE: "migrations",
        }).status,
        0,
      );
      const retryLogStart = readExternalLog(fixture).length;

      assert.equal(
        runGateway(fixture, "deploy", "v1", 211, {
          INSIDE_DEPLOY_TEST_NONEMPTY_DATABASE: "true",
        }).status,
        0,
      );
      const retryLog = readExternalLog(fixture).slice(retryLogStart);
      assert.match(retryLog, /--verify-schema-compatible/u);
      assert.equal(readState(fixture).current.version, "v1");
    } finally {
      fixture.cleanup();
    }
  });

  it("resumes a schema-changing deployment left running by an abrupt interruption", () => {
    const fixture = createHostFixture();
    try {
      assertGatewaySuccess(fixture, "deploy", "v1", 212);
      assert.notEqual(
        runGateway(fixture, "deploy", "v2", 213, {
          INSIDE_DEPLOY_FAIL_PHASE: "readiness",
        }).status,
        0,
      );
      const operationPath = resolve(
        fixture.root,
        "var/lib/inside/deployments/operation.json",
      );
      const interruptedOperation = JSON.parse(
        readFileSync(operationPath, "utf8"),
      );
      writeFileSync(
        operationPath,
        `${JSON.stringify({ ...interruptedOperation, status: "running" }, null, 2)}\n`,
      );

      assert.notEqual(
        runGateway(fixture, "deploy", "v2", 214, {
          INSIDE_DEPLOY_FAIL_PHASE: "preflight",
        }).status,
        0,
      );
      assert.equal(
        JSON.parse(readFileSync(operationPath, "utf8")).recoveryPhase,
        "readiness",
      );

      assert.equal(
        runGateway(fixture, "deploy", "v2", 215, {
          INSIDE_DEPLOY_TEST_CURRENT_SCHEMA_MISMATCH: "true",
        }).status,
        0,
      );
      assert.equal(readState(fixture).current.version, "v2");
    } finally {
      fixture.cleanup();
    }
  });

  it("rejects a different command without overwriting an unfinished recovery", () => {
    const fixture = createHostFixture();
    try {
      assertGatewaySuccess(fixture, "deploy", "v1", 216);
      assert.notEqual(
        runGateway(fixture, "deploy", "v2", 217, {
          INSIDE_DEPLOY_FAIL_PHASE: "readiness",
        }).status,
        0,
      );
      const operationPath = resolve(
        fixture.root,
        "var/lib/inside/deployments/operation.json",
      );
      const recoveryJournal = readFileSync(operationPath, "utf8");

      const stale = runGateway(fixture, "deploy", "v1", 218);
      assert.notEqual(stale.status, 0);
      assert.match(stale.stderr, /unfinished deployment operation/u);
      assert.equal(readFileSync(operationPath, "utf8"), recoveryJournal);

      assert.equal(
        runGateway(fixture, "deploy", "v2", 219, {
          INSIDE_DEPLOY_TEST_CURRENT_SCHEMA_MISMATCH: "true",
        }).status,
        0,
      );
      assert.equal(readState(fixture).current.version, "v2");
    } finally {
      fixture.cleanup();
    }
  });

  it("rejects an impossible recovery phase without overwriting the journal", () => {
    const fixture = createHostFixture();
    try {
      const operationPath = resolve(
        fixture.root,
        "var/lib/inside/deployments/operation.json",
      );
      const impossibleJournal = `${JSON.stringify({
        schemaVersion: "inside.platform.deployment-operation.v1",
        status: "failed",
        operation: "deploy",
        version: "v1",
        phase: "readiness",
        recoveryPhase: "preflight",
        repairForward: null,
        githubRunId: 220,
        recordedAt: "2026-09-04T20:00:00Z",
      }, null, 2)}\n`;
      mkdirSync(resolve(operationPath, ".."), { recursive: true });
      writeFileSync(operationPath, impossibleJournal);

      const result = runGateway(fixture, "deploy", "v2", 221);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /operation journal is invalid/u);
      assert.equal(readFileSync(operationPath, "utf8"), impossibleJournal);
    } finally {
      fixture.cleanup();
    }
  });

  it("survives two consecutive preflight failures before an exact retry", () => {
    const fixture = createHostFixture();
    try {
      assertGatewaySuccess(fixture, "deploy", "v1", 232);
      for (const runId of [233, 234]) {
        assert.notEqual(
          runGateway(fixture, "deploy", "v2", runId, {
            INSIDE_DEPLOY_FAIL_PHASE: "preflight",
          }).status,
          0,
        );
        const operation = JSON.parse(
          readFileSync(
            resolve(
              fixture.root,
              "var/lib/inside/deployments/operation.json",
            ),
            "utf8",
          ),
        );
        assert.equal(operation.phase, "preflight");
        assert.equal(operation.recoveryPhase, null);
      }

      assertGatewaySuccess(fixture, "deploy", "v2", 235);
      assert.equal(readState(fixture).current.version, "v2");
    } finally {
      fixture.cleanup();
    }
  });

  it("rejects a rollback journal that claims a migration phase", () => {
    const fixture = createHostFixture();
    try {
      const operationPath = resolve(
        fixture.root,
        "var/lib/inside/deployments/operation.json",
      );
      const impossibleJournal = `${JSON.stringify({
        schemaVersion: "inside.platform.deployment-operation.v1",
        status: "failed",
        operation: "rollback",
        version: "v1",
        phase: "migrations",
        recoveryPhase: "migrations",
        repairForward: null,
        githubRunId: 236,
        recordedAt: "2026-09-04T20:00:00Z",
      }, null, 2)}\n`;
      mkdirSync(resolve(operationPath, ".."), { recursive: true });
      writeFileSync(operationPath, impossibleJournal);

      const result = runGateway(fixture, "rollback", "v1", 237);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /operation journal is invalid/u);
      assert.equal(readFileSync(operationPath, "utf8"), impossibleJournal);
    } finally {
      fixture.cleanup();
    }
  });

  it("repairs the first deployment forward after its migrations completed", () => {
    const fixture = createHostFixture({ compatible: false });
    try {
      assert.notEqual(
        runGateway(fixture, "deploy", "v1", 222, {
          INSIDE_DEPLOY_FAIL_PHASE: "readiness",
        }).status,
        0,
      );
      const operationPath = resolve(
        fixture.root,
        "var/lib/inside/deployments/operation.json",
      );
      const failedJournal = readFileSync(operationPath, "utf8");
      const repairLogStart = readExternalLog(fixture).length;

      assert.notEqual(
        runGateway(fixture, "deploy", "v2", 223, {
          INSIDE_DEPLOY_FAIL_PHASE: "maintenance",
          INSIDE_DEPLOY_TEST_NONEMPTY_DATABASE: "true",
        }).status,
        0,
      );
      const repairOperation = JSON.parse(readFileSync(operationPath, "utf8"));
      assert.deepEqual(repairOperation.repairForward, {
        version: "v1",
        githubRunId: 222,
        recoveryPhase: "readiness",
      });
      assert.equal(
        runGateway(fixture, "deploy", "v2", 224, {
          INSIDE_DEPLOY_TEST_NONEMPTY_DATABASE: "true",
        }).status,
        0,
      );
      const state = readState(fixture);
      assert.equal(state.current.version, "v2");
      assert.equal(state.previous, null);
      assert.equal(state.rollback, null);
      assert.equal(
        readFileSync(
          resolve(
            fixture.root,
            "var/lib/inside/deployments/operation-history/deploy-v1-run-222.json",
          ),
          "utf8",
        ),
        failedJournal,
      );
      const repairLog = readExternalLog(fixture).slice(repairLogStart);
      assert.match(repairLog, /releases\/v1\/runtime\/compose\.production\.yaml.*--verify-schema-identity/u);
      assert.match(repairLog, /releases\/v2\/runtime\/compose\.production\.yaml.*--verify-schema-compatible/u);
      const failedSchemaProof = repairLog.indexOf(
        "/releases/v1/runtime/compose.production.yaml run --pull never --rm --no-deps migrations node dist/migrations/migrate.js --verify-schema-identity",
      );
      const maintenance = repairLog.indexOf("caddy reload");
      const targetPull = repairLog.indexOf(
        "docker pull ghcr.io/sachkov-inside/platform-backend@sha256:dddd",
      );
      const targetCompatibility = repairLog.indexOf(
        "/releases/v2/runtime/compose.production.yaml run --pull never --rm --no-deps migrations node dist/migrations/migrate.js --verify-schema-compatible",
      );
      assert.ok(failedSchemaProof >= 0);
      assert.ok(maintenance > failedSchemaProof);
      assert.ok(targetPull > maintenance);
      assert.ok(targetCompatibility > targetPull);
    } finally {
      fixture.cleanup();
    }
  });

  it("repairs forward from a compatible partial migration ledger", () => {
    const fixture = createHostFixture();
    try {
      assert.notEqual(
        runGateway(fixture, "deploy", "v1", 230, {
          INSIDE_DEPLOY_FAIL_PHASE: "migrations",
        }).status,
        0,
      );
      const repairLogStart = readExternalLog(fixture).length;

      assert.equal(
        runGateway(fixture, "deploy", "v2", 231, {
          INSIDE_DEPLOY_TEST_NONEMPTY_DATABASE: "true",
        }).status,
        0,
      );
      assert.equal(readState(fixture).current.version, "v2");
      const repairLog = readExternalLog(fixture).slice(repairLogStart);
      assert.match(
        repairLog,
        /releases\/v1\/runtime\/compose\.production\.yaml.*--verify-schema-compatible/u,
      );
      assert.doesNotMatch(
        repairLog,
        /releases\/v1\/runtime\/compose\.production\.yaml.*--verify-schema-identity/u,
      );
    } finally {
      fixture.cleanup();
    }
  });

  it("repairs forward to the ordinal after a failed upgrade", () => {
    const fixture = createHostFixture();
    try {
      assertGatewaySuccess(fixture, "deploy", "v1", 224);
      assert.notEqual(
        runGateway(fixture, "deploy", "v2", 225, {
          INSIDE_DEPLOY_FAIL_PHASE: "readiness",
        }).status,
        0,
      );
      const operationPath = resolve(
        fixture.root,
        "var/lib/inside/deployments/operation.json",
      );
      const failedJournal = readFileSync(operationPath, "utf8");
      const repairLogStart = readExternalLog(fixture).length;

      assert.equal(
        runGateway(fixture, "deploy", "v3", 226, {
          INSIDE_DEPLOY_TEST_CURRENT_SCHEMA_MISMATCH: "true",
        }).status,
        0,
      );
      const state = readState(fixture);
      assert.equal(state.current.version, "v3");
      assert.equal(state.previous.version, "v1");
      assert.equal(state.rollback, null);
      assert.equal(
        readFileSync(
          resolve(
            fixture.root,
            "var/lib/inside/deployments/operation-history/deploy-v2-run-225.json",
          ),
          "utf8",
        ),
        failedJournal,
      );
      const repairLog = readExternalLog(fixture).slice(repairLogStart);
      const failedWorkersStop = repairLog.indexOf(
        "/releases/v2/runtime/compose.production.yaml stop --timeout 20",
      );
      const repairStart = repairLog.indexOf(
        "/releases/v3/runtime/compose.production.yaml up --detach",
      );
      assert.ok(failedWorkersStop >= 0);
      assert.ok(repairStart > failedWorkersStop);
    } finally {
      fixture.cleanup();
    }
  });

  it("retries a repair candidate after that candidate changed the schema", () => {
    const fixture = createHostFixture();
    try {
      assertGatewaySuccess(fixture, "deploy", "v1", 238);
      assert.notEqual(
        runGateway(fixture, "deploy", "v2", 239, {
          INSIDE_DEPLOY_FAIL_PHASE: "readiness",
        }).status,
        0,
      );
      assert.notEqual(
        runGateway(fixture, "deploy", "v3", 240, {
          INSIDE_DEPLOY_FAIL_PHASE: "readiness",
          INSIDE_DEPLOY_TEST_CURRENT_SCHEMA_MISMATCH: "true",
        }).status,
        0,
      );
      const repairOperation = JSON.parse(
        readFileSync(
          resolve(
            fixture.root,
            "var/lib/inside/deployments/operation.json",
          ),
          "utf8",
        ),
      );
      assert.deepEqual(repairOperation.repairForward, {
        version: "v2",
        githubRunId: 239,
        recoveryPhase: "readiness",
      });
      const retryLogStart = readExternalLog(fixture).length;

      assert.equal(
        runGateway(fixture, "deploy", "v3", 241, {
          INSIDE_DEPLOY_TEST_CURRENT_SCHEMA_MISMATCH: "true",
        }).status,
        0,
      );
      assert.equal(readState(fixture).current.version, "v3");
      const retryLog = readExternalLog(fixture).slice(retryLogStart);
      assert.match(
        retryLog,
        /releases\/v3\/runtime\/compose\.production\.yaml.*--verify-schema-identity/u,
      );
      assert.doesNotMatch(
        retryLog,
        /releases\/v2\/runtime\/compose\.production\.yaml.*--verify-schema-identity/u,
      );
      const repairWorkersStop = retryLog.indexOf(
        "/releases/v3/runtime/compose.production.yaml stop --timeout 20",
      );
      const repairMigrations = retryLog.indexOf(
        "/releases/v3/runtime/compose.production.yaml run --rm migrations",
      );
      assert.ok(repairWorkersStop >= 0);
      assert.ok(repairMigrations > repairWorkersStop);
    } finally {
      fixture.cleanup();
    }
  });

  it("closes a repair operation interrupted after successful state was written", () => {
    const fixture = createHostFixture();
    try {
      assertGatewaySuccess(fixture, "deploy", "v1", 242);
      assert.notEqual(
        runGateway(fixture, "deploy", "v2", 243, {
          INSIDE_DEPLOY_FAIL_PHASE: "readiness",
        }).status,
        0,
      );
      const interrupted = runGateway(fixture, "deploy", "v3", 244, {
        INSIDE_DEPLOY_TEST_CURRENT_SCHEMA_MISMATCH: "true",
        INSIDE_DEPLOY_TEST_INTERRUPT_AFTER_STATE: "true",
      });
      assert.notEqual(interrupted.status, 0);
      assert.equal(readState(fixture).current.version, "v3");
      const operationPath = resolve(
        fixture.root,
        "var/lib/inside/deployments/operation.json",
      );
      let operation = JSON.parse(readFileSync(operationPath, "utf8"));
      assert.equal(operation.status, "running");
      assert.equal(operation.phase, "journal");
      assert.deepEqual(operation.repairForward, {
        version: "v2",
        githubRunId: 243,
        recoveryPhase: "readiness",
      });

      assertGatewaySuccess(fixture, "deploy", "v3", 245);
      operation = JSON.parse(readFileSync(operationPath, "utf8"));
      assert.equal(operation.status, "succeeded");
      assert.equal(operation.phase, "complete");
      assert.equal(operation.recoveryPhase, null);
      assert.equal(readState(fixture).current.version, "v3");
    } finally {
      fixture.cleanup();
    }
  });

  it("closes a rollback interrupted after successful state was written", () => {
    const fixture = createHostFixture();
    try {
      assertGatewaySuccess(fixture, "deploy", "v1", 246);
      assertGatewaySuccess(fixture, "deploy", "v2", 247);
      const interrupted = runGateway(fixture, "rollback", "v1", 248, {
        INSIDE_DEPLOY_TEST_INTERRUPT_AFTER_STATE: "true",
      });
      assert.notEqual(interrupted.status, 0);
      let state = readState(fixture);
      assert.equal(state.operation, "rollback");
      assert.equal(state.current.version, "v1");
      assert.equal(state.current.githubRunId, 248);
      assert.equal(state.rollback, null);
      assert.equal(state.rolledBackFrom.version, "v2");

      const operationPath = resolve(
        fixture.root,
        "var/lib/inside/deployments/operation.json",
      );
      let operation = JSON.parse(readFileSync(operationPath, "utf8"));
      assert.equal(operation.status, "running");
      assert.equal(operation.operation, "rollback");
      assert.equal(operation.version, "v1");
      assert.equal(operation.phase, "journal");
      assert.equal(operation.recoveryPhase, "journal");
      const interruptedJournal = readFileSync(operationPath, "utf8");

      const failedRetry = runGateway(fixture, "rollback", "v1", 249, {
        INSIDE_DEPLOY_FAIL_PHASE: "preflight",
      });
      assert.notEqual(failedRetry.status, 0);
      assert.match(failedRetry.stderr, /Injected deployment failure at preflight/u);
      assert.equal(readFileSync(operationPath, "utf8"), interruptedJournal);

      const retryLogStart = readExternalLog(fixture).length;
      assertGatewaySuccess(fixture, "rollback", "v1", 250);
      state = readState(fixture);
      assert.equal(state.current.version, "v1");
      assert.equal(state.current.githubRunId, 248);
      operation = JSON.parse(readFileSync(operationPath, "utf8"));
      assert.equal(operation.status, "succeeded");
      assert.equal(operation.phase, "complete");
      assert.equal(operation.recoveryPhase, null);
      const retryLog = readExternalLog(fixture).slice(retryLogStart);
      assert.match(retryLog, /--verify-schema-identity/u);
      assert.doesNotMatch(
        retryLog,
        /docker pull|caddy reload| up --detach| run --rm migrations/u,
      );
      const repeated = runGateway(fixture, "rollback", "v1", 251);
      assert.notEqual(repeated.status, 0);
      assert.match(repeated.stderr, /unknown, incompatible or expired/u);
    } finally {
      fixture.cleanup();
    }
  });

  it("rejects repair forward when the live schema does not match the failed release", () => {
    const fixture = createHostFixture();
    try {
      assertGatewaySuccess(fixture, "deploy", "v1", 227);
      assert.notEqual(
        runGateway(fixture, "deploy", "v2", 228, {
          INSIDE_DEPLOY_FAIL_PHASE: "readiness",
        }).status,
        0,
      );
      const operationPath = resolve(
        fixture.root,
        "var/lib/inside/deployments/operation.json",
      );
      const failedJournal = readFileSync(operationPath, "utf8");

      const result = runGateway(fixture, "deploy", "v3", 229, {
        INSIDE_DEPLOY_TEST_FAILED_SCHEMA_MISMATCH: "true",
      });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Failed release schema mismatch/u);
      assert.equal(readFileSync(operationPath, "utf8"), failedJournal);
      assert.equal(
        existsSync(
          resolve(
            fixture.root,
            "var/lib/inside/deployments/operation-history/deploy-v2-run-228.json",
          ),
        ),
        false,
      );
    } finally {
      fixture.cleanup();
    }
  });

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

  it("finishes an accepted rollback after its selection window expires", () => {
    const fixture = createHostFixture();
    try {
      assert.equal(
        runGateway(fixture, "deploy", "v1", 310, {
          INSIDE_DEPLOY_TEST_NOW_EPOCH: "100",
        }).status,
        0,
      );
      assert.equal(
        runGateway(fixture, "deploy", "v2", 311, {
          INSIDE_DEPLOY_TEST_NOW_EPOCH: "200",
        }).status,
        0,
      );
      const accepted = runGateway(fixture, "rollback", "v1", 312, {
        INSIDE_DEPLOY_FAIL_PHASE: "readiness",
        INSIDE_DEPLOY_TEST_NOW_EPOCH: "86599",
      });
      assert.notEqual(accepted.status, 0);
      assert.equal(readState(fixture).current.version, "v2");
      const operation = JSON.parse(
        readFileSync(
          resolve(fixture.root, "var/lib/inside/deployments/operation.json"),
          "utf8",
        ),
      );
      assert.equal(operation.status, "failed");
      assert.equal(operation.operation, "rollback");
      assert.equal(operation.version, "v1");
      assert.equal(operation.recoveryPhase, "readiness");

      assert.equal(
        runGateway(fixture, "rollback", "v1", 313, {
          INSIDE_DEPLOY_TEST_NOW_EPOCH: "86601",
        }).status,
        0,
      );
      assert.equal(readState(fixture).current.version, "v1");
    } finally {
      fixture.cleanup();
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
    resolve(bin, "flock"),
    '#!/usr/bin/env bash\nset -euo pipefail\nexit 0\n',
  );
  writeExecutable(
    resolve(bin, "docker"),
    `#!/usr/bin/env bash
set -euo pipefail
printf "docker %s\\n" "$*" >>"$INSIDE_DEPLOY_TEST_ROOT/external.log"
if [[ "$*" == *"config --format json"* ]]; then
  printf '{"networks":{"database":{"name":"inside-platform-database-test"}},"services":{"api":{"ports":[{"host_ip":"127.0.0.1","target":3001,"published":"13001","protocol":"tcp"}]},"web":{"ports":[{"host_ip":"127.0.0.1","target":3000,"published":"13000","protocol":"tcp"}]}}}\n'
elif [[ "$*" == *"ps --filter network="*"--filter label=com.docker.compose.service=postgres --quiet"* ]]; then
  printf '%s\n' '${"f".repeat(64)}'
elif [[ "$*" == *"exec --env-file "*" psql "* ]]; then
  if [[ "\${INSIDE_DEPLOY_TEST_NONEMPTY_DATABASE:-}" == true ]]; then
    printf 'f\n'
  else
    printf 't\n'
  fi
fi
if [[ "\${INSIDE_DEPLOY_TEST_SCHEMA_MISMATCH:-}" == true && "$*" == *"--verify-schema-identity"* ]]; then
  echo "Migration ledger mismatch" >&2
  exit 1
fi
if [[ "\${INSIDE_DEPLOY_TEST_CURRENT_SCHEMA_MISMATCH:-}" == true && "$*" == *"/releases/v1/"* && "$*" == *"--verify-schema-identity"* ]]; then
  echo "Current release schema mismatch" >&2
  exit 1
fi
if [[ "\${INSIDE_DEPLOY_TEST_FAILED_SCHEMA_MISMATCH:-}" == true && "$*" == *"/releases/v2/"* && "$*" == *"--verify-schema-identity"* ]]; then
  echo "Failed release schema mismatch" >&2
  exit 1
fi
`,
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
  const v2ManifestDigest = sha256(v2Manifest);
  const v3Manifest = releaseManifest({
    bundleDigest,
    runId: 93,
    schemaIdentity,
    sourceSha: "3".repeat(40),
    version: "v3",
    previous: {
      version: "v2",
      sourceSha: "2".repeat(40),
      manifestSha256: v2ManifestDigest,
      schemaIdentity,
      compatible,
      verifiedByWorkflowRunId: 93,
    },
  });
  writeTrustedReleaseEvidence(root, {
    manifest: v1Manifest,
    publicationRunId: 91,
    sourceSha: "1".repeat(40),
    version: "v1",
  });
  writeTrustedReleaseEvidence(root, {
    manifest: v2Manifest,
    publicationRunId: 92,
    sourceSha: "2".repeat(40),
    version: "v2",
  });
  writeTrustedReleaseEvidence(root, {
    manifest: v3Manifest,
    publicationRunId: 93,
    sourceSha: "3".repeat(40),
    version: "v3",
  });

  const fixture = {
    bin,
    bundle,
    cleanup: () => rmSync(directory, { force: true, recursive: true }),
    directory,
    manifests: { v1: v1Manifest, v2: v2Manifest, v3: v3Manifest },
    root,
  };
  for (const version of ["v1", "v2", "v3"]) {
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
  const imageDigests = {
    v1: ["a", "b"],
    v2: ["d", "e"],
    v3: ["f", "0"],
  }[version];
  assert.ok(imageDigests, `missing image fixture for ${version}`);
  return `${JSON.stringify({
    schemaVersion: "inside.platform.release-manifest.v2",
    version,
    source: { repository: "sachkov-inside/platform", sha: sourceSha },
    images: {
      backend: `ghcr.io/sachkov-inside/platform-backend@sha256:${imageDigests[0].repeat(64)}`,
      web: `ghcr.io/sachkov-inside/platform-web@sha256:${imageDigests[1].repeat(64)}`,
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
