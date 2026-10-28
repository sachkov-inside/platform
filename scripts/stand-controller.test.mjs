// @ts-check
import assert from "node:assert/strict";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { controlStand, requireUnmanagedStand } from "./stand-controller.mjs";
import { acquireLocalSetupLock } from "./local-setup-lock.mjs";

/** @param {import("node:test").TestContext} t */
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "stand-controller-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  /** @type {import("./stand-controller.mjs").StandSnapshot} */
  let snapshot = { daemon: "fixture", containers: [] };
  let preparations = 0;
  const inputs = {
    fingerprint: "source-a",
    build: "build-a",
    schema: "schema-a",
    infrastructure: "infra-a",
    identity: "identity-a",
  };
  const dependencies = {
    directory,
    controller: "/fixture/controller",
    acquire: () => acquireLocalSetupLock("busy", join(directory, "lock")),
    inspect: async () => snapshot,
    source: async (/** @type {string} */ root) => ({
      root,
      head: "1".repeat(40),
      ...inputs,
    }),
    prepare: async (
      /** @type {import("./stand-controller.mjs").StandOperation} */ operation,
    ) => {
      preparations++;
      const postgres = (!operation.cold &&
        snapshot.containers.find(
          (container) => container.service === "postgres",
        )) || {
        id: `postgres-${operation.generation}`,
        service: "postgres",
        image: "postgres-image",
        generation: operation.generation,
        running: true,
        health: "healthy",
      };
      snapshot = {
        daemon: "fixture",
        containers: [
          postgres,
          {
            id: `web-${preparations}`,
            service: "web",
            image: "image-a",
            generation: operation.generation,
            running: true,
            health: "healthy",
          },
        ],
      };
    },
    ready: async () => ({
      schema: "runtime-schema-a",
      url: "http://127.0.0.1:3000",
    }),
  };
  return {
    dependencies,
    inputs,
    preparations: () => preparations,
    setSnapshot: (
      /** @type {import("./stand-controller.mjs").StandSnapshot} */ value,
    ) => {
      snapshot = value;
    },
  };
}

test("an unused stand reports no reservation without starting an environment", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "stand-controller-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const result = await controlStand(
    { command: "status", worktree: "/fixture/a" },
    {
      directory,
      controller: "/fixture/controller",
      inspect: async () => ({ daemon: "fixture", containers: [] }),
    },
  );
  assert.equal(result.status, "stopped");
  assert.equal(result.reservation, null);
});

test("an explicit replacement uses the current reservation and rejects a stale replacement", async (t) => {
  const { dependencies, preparations } = await fixture(t);
  const first = await controlStand(
    { command: "show", worktree: "/fixture/a" },
    dependencies,
  );
  assert.ok(first.reservation);
  const second = await controlStand(
    { command: "show", worktree: "/fixture/b", replace: first.reservation.id },
    dependencies,
  );
  assert.equal(second.reservation?.worktree, "/fixture/b");
  assert.notEqual(second.reservation?.id, first.reservation.id);
  await assert.rejects(
    controlStand(
      {
        command: "show",
        worktree: "/fixture/a",
        replace: first.reservation.id,
      },
      dependencies,
    ),
    /reservation changed/u,
  );
  assert.equal(preparations(), 2);
});

test("legacy startup cannot bypass a durable reservation after containers stop", async (t) => {
  const { dependencies } = await fixture(t);
  await controlStand({ command: "show", worktree: "/fixture/a" }, dependencies);
  await assert.rejects(
    requireUnmanagedStand(dependencies.directory),
    /managed by/u,
  );
});

test("invalid or redirected state refuses before any runtime preparation", async (t) => {
  const { dependencies, preparations } = await fixture(t);
  await writeFile(join(dependencies.directory, "state.json"), "{incomplete");
  await assert.rejects(
    controlStand({ command: "show", worktree: "/fixture/a" }, dependencies),
    /state is invalid/u,
  );
  await rm(join(dependencies.directory, "state.json"));
  const unrelated = join(dependencies.directory, "unrelated.json");
  await writeFile(unrelated, "{}");
  await symlink(unrelated, join(dependencies.directory, "state.json"));
  await assert.rejects(
    controlStand({ command: "show", worktree: "/fixture/a" }, dependencies),
    /state is invalid/u,
  );
  assert.equal(preparations(), 0);
});

test("a shown task stays reserved after the calling session ends", async (t) => {
  const { dependencies, preparations } = await fixture(t);
  const shown = await controlStand(
    { command: "show", worktree: "/fixture/a" },
    dependencies,
  );
  assert.equal(shown.status, "ready");
  assert.equal(shown.reservation?.worktree, "/fixture/a");
  const later = await controlStand(
    { command: "status", worktree: "/fixture/b" },
    { ...dependencies },
  );
  assert.deepEqual(later.reservation, shown.reservation);
  assert.equal(later.status, "ready");
  assert.equal(preparations(), 1);
});

test("another worktree cannot replace a reserved review", async (t) => {
  const { dependencies, preparations } = await fixture(t);
  const original = await controlStand(
    { command: "show", worktree: "/fixture/a" },
    dependencies,
  );
  await assert.rejects(
    controlStand({ command: "show", worktree: "/fixture/b" }, dependencies),
    /reserved/u,
  );
  const current = await controlStand(
    { command: "status", worktree: "/fixture/b" },
    dependencies,
  );
  assert.deepEqual(current.reservation, original.reservation);
  assert.equal(preparations(), 1);
});

test("showing the same ready source again avoids rebuilding and keeps its reservation", async (t) => {
  const { dependencies, preparations } = await fixture(t);
  const first = await controlStand(
    { command: "show", worktree: "/fixture/a" },
    dependencies,
  );
  const again = await controlStand(
    { command: "show", worktree: "/fixture/a" },
    dependencies,
  );
  assert.equal(again.status, "ready");
  assert.deepEqual(again.reservation, first.reservation);
  assert.equal(preparations(), 1);
});

test("release leaves the application running and permits the next worktree to show its task", async (t) => {
  const { dependencies, preparations } = await fixture(t);
  await controlStand({ command: "show", worktree: "/fixture/a" }, dependencies);
  const released = await controlStand(
    { command: "release", worktree: "/fixture/a" },
    dependencies,
  );
  assert.equal(released.status, "ready");
  assert.equal(released.reservation, null);
  assert.equal(preparations(), 1);
  const next = await controlStand(
    { command: "show", worktree: "/fixture/b" },
    dependencies,
  );
  assert.equal(next.reservation?.worktree, "/fixture/b");
  assert.equal(preparations(), 2);
});

for (const field of /** @type {const} */ (["schema", "infrastructure"])) {
  test(`a different ${field} refuses before replacing the running application`, async (t) => {
    const { dependencies, inputs, preparations } = await fixture(t);
    const original = await controlStand(
      { command: "show", worktree: "/fixture/a" },
      dependencies,
    );
    assert.ok(original.reservation);
    inputs[field] = "incompatible";
    inputs.fingerprint = "source-b";
    await assert.rejects(
      controlStand(
        {
          command: "show",
          worktree: "/fixture/b",
          replace: original.reservation.id,
        },
        dependencies,
      ),
      /schema|infrastructure/u,
    );
    assert.equal(preparations(), 1);
    const current = await controlStand(
      { command: "status", worktree: "/fixture/a" },
      dependencies,
    );
    assert.deepEqual(current.reservation, original.reservation);
  });
}

test("a running environment without a controller receipt is never adopted", async (t) => {
  const { dependencies, setSnapshot, preparations } = await fixture(t);
  setSnapshot({
    daemon: "fixture",
    containers: [
      {
        id: "owners-web",
        service: "web",
        image: "owners-image",
        generation: "",
        running: true,
        health: "healthy",
      },
    ],
  });
  await assert.rejects(
    controlStand({ command: "show", worktree: "/fixture/a" }, dependencies),
    /unmanaged/u,
  );
  assert.equal(preparations(), 0);
});

test("replaced containers invalidate ready and cannot be overwritten by refresh", async (t) => {
  const { dependencies, setSnapshot, preparations } = await fixture(t);
  await controlStand({ command: "show", worktree: "/fixture/a" }, dependencies);
  setSnapshot({
    daemon: "fixture",
    containers: [
      {
        id: "foreign-web",
        service: "web",
        image: "foreign-image",
        generation: "",
        running: true,
        health: "healthy",
      },
    ],
  });
  const current = await controlStand(
    { command: "status", worktree: "/fixture/a" },
    dependencies,
  );
  assert.equal(current.status, "unmanaged");
  await assert.rejects(
    controlStand({ command: "refresh", worktree: "/fixture/a" }, dependencies),
    /unmanaged/u,
  );
  assert.equal(preparations(), 1);
});

test("simultaneous requests cannot both prepare the singleton", async (t) => {
  const { dependencies, preparations } = await fixture(t);
  const entered = Promise.withResolvers();
  const finish = Promise.withResolvers();
  const prepare = dependencies.prepare;
  dependencies.prepare = async (operation) => {
    entered.resolve(undefined);
    await finish.promise;
    await prepare(operation);
  };
  const first = controlStand(
    { command: "show", worktree: "/fixture/a" },
    dependencies,
  );
  try {
    await entered.promise;
    await assert.rejects(
      controlStand({ command: "show", worktree: "/fixture/b" }, dependencies),
      /busy/u,
    );
  } finally {
    finish.resolve(undefined);
    await first;
  }
  assert.equal(preparations(), 1);
});

test("source edits during preparation leave recovery state instead of a false ready receipt", async (t) => {
  const { dependencies, inputs } = await fixture(t);
  const prepare = dependencies.prepare;
  dependencies.prepare = async (operation) => {
    await prepare(operation);
    inputs.fingerprint = "changed-during-build";
    inputs.build = "changed-during-build";
  };
  await assert.rejects(
    controlStand({ command: "show", worktree: "/fixture/a" }, dependencies),
    /changed during/u,
  );
  const current = await controlStand(
    { command: "status", worktree: "/fixture/a" },
    dependencies,
  );
  assert.equal(current.status, "recovery");
  assert.equal(current.reservation?.worktree, "/fixture/a");
});

test("live Web edits reuse the running image, while backend edits rebuild", async (t) => {
  const { dependencies, inputs, preparations } = await fixture(t);
  await controlStand(
    { command: "show", worktree: "/fixture/a", mode: "live" },
    dependencies,
  );
  inputs.fingerprint = "web-edited";
  await controlStand(
    { command: "refresh", worktree: "/fixture/a" },
    dependencies,
  );
  assert.equal(preparations(), 1);
  inputs.build = "backend-edited";
  inputs.fingerprint = "backend-edited";
  await controlStand(
    { command: "refresh", worktree: "/fixture/a" },
    dependencies,
  );
  assert.equal(preparations(), 2);
});

test("refresh can repair unhealthy application processes without releasing their review", async (t) => {
  const { dependencies, preparations } = await fixture(t);
  const original = await controlStand(
    { command: "show", worktree: "/fixture/a" },
    dependencies,
  );
  const ready = dependencies.ready;
  let healthy = false;
  dependencies.ready = async () => {
    if (!healthy) throw new Error("application unavailable");
    return ready();
  };
  const prepare = dependencies.prepare;
  dependencies.prepare = async (operation) => {
    await prepare(operation);
    healthy = true;
  };
  const current = await controlStand(
    { command: "refresh", worktree: "/fixture/a" },
    dependencies,
  );
  assert.equal(current.status, "ready");
  assert.deepEqual(current.reservation, original.reservation);
  assert.equal(preparations(), 2);
});

test("repeated preparation failures retain ownership of the last partial generation", async (t) => {
  const { dependencies, inputs } = await fixture(t);
  await controlStand({ command: "show", worktree: "/fixture/a" }, dependencies);
  inputs.fingerprint = "next-source";
  const prepare = dependencies.prepare;
  let attempt = 0;
  dependencies.prepare = async (operation) => {
    attempt++;
    if (attempt === 1) {
      await prepare(operation);
      throw new Error("partial replacement");
    }
    if (attempt === 2) throw new Error("build failed before replacement");
    await prepare(operation);
  };
  const request = {
    command: /** @type {const} */ ("refresh"),
    worktree: "/fixture/a",
  };
  await assert.rejects(
    controlStand(request, dependencies),
    /partial replacement/u,
  );
  await assert.rejects(controlStand(request, dependencies), /build failed/u);
  const result = await controlStand(request, dependencies);
  assert.equal(result.status, "ready");
});

test("an unavailable application cannot authorize switching to edited source", async (t) => {
  const { dependencies, inputs, preparations } = await fixture(t);
  await controlStand({ command: "show", worktree: "/fixture/a" }, dependencies);
  dependencies.ready = async () => {
    throw new Error("application unavailable");
  };
  inputs.fingerprint = "changed";
  await assert.rejects(
    controlStand({ command: "refresh", worktree: "/fixture/a" }, dependencies),
    /application unavailable/u,
  );
  assert.equal(preparations(), 1);
});

test("replacement is available only for an explicitly shown task", async (t) => {
  const { dependencies } = await fixture(t);
  const first = await controlStand(
    { command: "show", worktree: "/fixture/a" },
    dependencies,
  );
  assert.ok(first.reservation);
  for (const command of /** @type {const} */ (["release", "refresh"])) {
    await assert.rejects(
      controlStand(
        { command, worktree: "/fixture/b", replace: first.reservation.id },
        dependencies,
      ),
      /replace.*show/u,
    );
  }
});

test("a failed cold start records its bootstrap identity but refuses unrelated identity changes", async (t) => {
  const { dependencies, inputs } = await fixture(t);
  const prepare = dependencies.prepare;
  dependencies.prepare = async (
    /** @type {import("./stand-controller.mjs").StandOperation} */ operation,
  ) => {
    inputs.identity = "controller-bootstrap";
    await operation.recordIdentity(inputs.identity);
    throw new Error("startup failed after bootstrap");
  };
  await assert.rejects(
    controlStand({ command: "show", worktree: "/fixture/a" }, dependencies),
    /startup failed/u,
  );
  dependencies.prepare = prepare;
  assert.equal(
    (
      await controlStand(
        { command: "refresh", worktree: "/fixture/a" },
        dependencies,
      )
    ).status,
    "ready",
  );
  inputs.identity = "unrelated-keys";
  await assert.rejects(
    controlStand({ command: "refresh", worktree: "/fixture/a" }, dependencies),
    /identity settings/u,
  );
});

test("interrupted cold preparation resumes bootstrap instead of refreshing an incomplete stack", async (t) => {
  const { dependencies } = await fixture(t);
  const prepare = dependencies.prepare;
  dependencies.prepare = async (operation) => {
    await prepare(operation);
    throw new Error("interrupted cold start");
  };
  await assert.rejects(
    controlStand({ command: "show", worktree: "/fixture/a" }, dependencies),
    /interrupted/u,
  );
  dependencies.prepare = async (operation) => {
    assert.equal(operation.cold, true);
    assert.equal(operation.resumeCold, true);
    await prepare(operation);
  };
  assert.equal(
    (
      await controlStand(
        { command: "refresh", worktree: "/fixture/a" },
        dependencies,
      )
    ).status,
    "ready",
  );
});

test("bootstrap receipt refuses a different current identity instead of adopting external keys", async (t) => {
  const { dependencies, inputs } = await fixture(t);
  dependencies.prepare = async (operation) => {
    inputs.identity = "external-replacement";
    await operation.recordIdentity("owned-bootstrap");
  };
  await assert.rejects(
    controlStand({ command: "show", worktree: "/fixture/a" }, dependencies),
    /identity no longer matches/u,
  );
  await assert.rejects(
    controlStand({ command: "refresh", worktree: "/fixture/a" }, dependencies),
    /identity settings/u,
  );
});

/** @param {import("node:test").TestContext} t */
async function upgradeFixture(t) {
  const base = await fixture(t);
  /** @type {string[]} */
  const events = [];
  let runtimeSchema = "runtime-schema-a";
  let failNextPreparation = false;
  let failNextBackup = false;
  const prepare = base.dependencies.prepare;
  const dependencies = {
    ...base.dependencies,
    backup: async (
      /** @type {import("./stand-controller.mjs").StandSnapshot} */ snapshot,
      /** @type {string} */ generation,
    ) => {
      events.push(`backup:${snapshot.containers.length}`);
      if (failNextBackup) {
        failNextBackup = false;
        throw new Error("dump failed");
      }
      return join(base.dependencies.directory, "backups", generation);
    },
    prepare: async (
      /** @type {import("./stand-controller.mjs").StandOperation} */ operation,
    ) => {
      events.push(operation.upgrade ? "upgrade" : "prepare");
      if (failNextPreparation) {
        failNextPreparation = false;
        throw new Error("migration failed");
      }
      await prepare(operation);
      if (operation.upgrade) runtimeSchema = "runtime-schema-b";
    },
    ready: async () => ({
      schema: runtimeSchema,
      url: "http://127.0.0.1:3000",
    }),
  };
  await controlStand({ command: "show", worktree: "/fixture/a" }, dependencies);
  events.length = 0;
  return {
    ...base,
    dependencies,
    events,
    failNextPreparation: () => {
      failNextPreparation = true;
    },
    failNextBackup: () => {
      failNextBackup = true;
    },
  };
}

test("upgrade moves a ready stand to newer schema and infrastructure after a backup", async (t) => {
  const { dependencies, inputs, events } = await upgradeFixture(t);
  inputs.schema = "schema-b";
  inputs.infrastructure = "infra-b";
  await assert.rejects(
    controlStand({ command: "refresh", worktree: "/fixture/a" }, dependencies),
    /migration or infrastructure handoff/u,
  );
  const result = await controlStand(
    { command: "upgrade", worktree: "/fixture/a" },
    dependencies,
  );
  assert.equal(result.status, "ready");
  assert.equal(result.source?.schema, "schema-b");
  assert.equal(result.source?.infrastructure, "infra-b");
  assert.deepEqual(events, ["backup:2", "upgrade"]);
  const refreshed = await controlStand(
    { command: "refresh", worktree: "/fixture/a" },
    dependencies,
  );
  assert.equal(refreshed.status, "ready");
});

test("upgrade without schema or infrastructure changes points to show or refresh", async (t) => {
  const { dependencies, events } = await upgradeFixture(t);
  await assert.rejects(
    controlStand({ command: "upgrade", worktree: "/fixture/a" }, dependencies),
    /already match.*show or refresh/u,
  );
  assert.deepEqual(events, []);
});

test("upgrade refuses a foreign reservation, changed identity or unready stand before any backup", async (t) => {
  const { dependencies, inputs, events, setSnapshot } = await upgradeFixture(t);
  inputs.schema = "schema-b";
  await assert.rejects(
    controlStand({ command: "upgrade", worktree: "/fixture/b" }, dependencies),
    /reserved for \/fixture\/a/u,
  );
  inputs.identity = "identity-b";
  await assert.rejects(
    controlStand({ command: "upgrade", worktree: "/fixture/a" }, dependencies),
    /identity settings changed/u,
  );
  inputs.identity = "identity-a";
  const ready = dependencies.ready;
  dependencies.ready = async () => {
    throw new Error("Stand service api is not ready");
  };
  await assert.rejects(
    controlStand({ command: "upgrade", worktree: "/fixture/a" }, dependencies),
    /ready before an upgrade/u,
  );
  dependencies.ready = ready;
  setSnapshot({ daemon: "fixture", containers: [] });
  await assert.rejects(
    controlStand({ command: "upgrade", worktree: "/fixture/a" }, dependencies),
    /running managed stand/u,
  );
  assert.deepEqual(events, []);
});

test("a failed upgrade keeps its backup, blocks other preparation and resumes on rerun", async (t) => {
  const { dependencies, inputs, events, failNextPreparation } =
    await upgradeFixture(t);
  inputs.schema = "schema-b";
  failNextPreparation();
  await assert.rejects(
    controlStand({ command: "upgrade", worktree: "/fixture/a" }, dependencies),
    /migration failed/u,
  );
  const failed = await controlStand(
    { command: "status", worktree: "/fixture/a" },
    dependencies,
  );
  assert.equal(failed.status, "recovery");
  await assert.rejects(
    controlStand({ command: "refresh", worktree: "/fixture/a" }, dependencies),
    /upgrade is incomplete.*backups/u,
  );
  const resumed = await controlStand(
    { command: "upgrade", worktree: "/fixture/a" },
    dependencies,
  );
  assert.equal(resumed.status, "ready");
  assert.deepEqual(events, ["backup:2", "upgrade", "upgrade"]);
});

test("a failed backup leaves the old schema protected and retakes the backup on rerun", async (t) => {
  const { dependencies, inputs, events, failNextBackup } =
    await upgradeFixture(t);
  inputs.schema = "schema-b";
  failNextBackup();
  await assert.rejects(
    controlStand({ command: "upgrade", worktree: "/fixture/a" }, dependencies),
    /dump failed.*backup: not taken/u,
  );
  await assert.rejects(
    controlStand({ command: "refresh", worktree: "/fixture/a" }, dependencies),
    /upgrade is incomplete/u,
  );
  const resumed = await controlStand(
    { command: "upgrade", worktree: "/fixture/a" },
    dependencies,
  );
  assert.equal(resumed.status, "ready");
  assert.deepEqual(events, ["backup:2", "backup:2", "upgrade"]);
});
