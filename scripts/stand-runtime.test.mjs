// @ts-check
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createStandRuntime } from "./stand-runtime.mjs";

test("runtime discovery rejects a remote Docker endpoint before inspecting or changing containers", async () => {
  /** @type {string[][]} */
  const calls = [];
  const runtime = createStandRuntime({
    environment: {},
    directory: "/fixture/state",
    pnpmPath: "/fixture/pnpm",
    run: async (args) => {
      calls.push(args);
      return JSON.stringify("tcp://remote.invalid:2375");
    },
  });
  await assert.rejects(runtime.inspect(), /local Docker/u);
  assert.equal(calls.length, 1);
});

test("runtime discovery reads actual container IDs and immutable images from the fixed project", async () => {
  const runtime = createStandRuntime({
    environment: {},
    directory: "/fixture/state",
    pnpmPath: "/fixture/pnpm",
    run: async (args) => {
      if (args[0] === "context")
        return JSON.stringify("unix:///fixture/docker.sock");
      if (args[0] === "info") return "fixture-daemon";
      if (args[0] === "container") {
        assert.ok(
          args.includes("label=com.docker.compose.project=inside-platform"),
        );
        return "fixture-container";
      }
      if (args[0] === "inspect")
        return JSON.stringify({
          id: "fixture-container",
          image: "sha256:fixture-image",
          service: "web",
          generation: "fixture-generation",
          running: true,
          health: "healthy",
        });
      throw new Error(`Unexpected Docker mutation: ${args[0]}`);
    },
  });
  const snapshot = await runtime.inspect();
  assert.equal(snapshot.daemon, "fixture-daemon");
  assert.equal(snapshot.containers[0]?.image, "sha256:fixture-image");
});

test("live preparation labels roles, mounts only selected Web source, and binds the verified Docker endpoint", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "stand-overlay-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const generation = randomUUID();
  let launched = false;
  let checkpoint = false;
  const environment = { DOCKER_HOST: "unix:///fixture/selected.sock" };
  const runtime = createStandRuntime({
    directory,
    pnpmPath: "/fixture/pnpm",
    environment,
    run: async (args) => {
      if (args[0] === "context")
        return JSON.stringify("unix:///fixture/context.sock");
      if (args[0] === "info") return "daemon";
      if (args[0] === "container") return "";
      assert.ok(args.includes("/task/compose.yaml"));
      return JSON.stringify({ services: { web: {}, api: {}, postgres: {} } });
    },
    launch: async (options) => {
      launched = true;
      assert.equal(options.repositoryRoot, "/task");
      assert.equal(options.dockerHost, "unix:///fixture/selected.sock");
      assert.equal(options.refresh, true);
      assert.ok(options.composeOverride);
      const overlay = z
        .object({
          services: z.record(
            z.string(),
            z.object({
              labels: z.record(z.string(), z.string()),
              volumes: z
                .array(
                  z.object({
                    source: z.string(),
                    target: z.string(),
                    read_only: z.boolean(),
                    bind: z.object({ create_host_path: z.boolean() }),
                  }),
                )
                .optional(),
            }),
          ),
        })
        .parse(JSON.parse(await readFile(options.composeOverride, "utf8")));
      assert.equal(
        overlay.services["api"]?.labels["inside.local-stand.generation"],
        generation,
      );
      assert.deepEqual(
        overlay.services["web"]?.volumes?.map((volume) => volume.source),
        ["/task/apps/web/app", "/task/apps/web/src", "/task/apps/web/public"],
      );
      assert.ok(
        overlay.services["web"]?.volumes?.every(
          (volume) => volume.read_only && !volume.bind.create_host_path,
        ),
      );
      assert.equal(overlay.services["postgres"]?.volumes, undefined);
      await options.onIdentityReady?.("fixture-owned-identity");
    },
  });
  await runtime.inspect();
  environment.DOCKER_HOST = "unix:///fixture/later.sock";
  await runtime.prepare({
    source: {
      root: "/task",
      head: "head",
      fingerprint: "source",
      build: "build",
      schema: "schema",
      infrastructure: "infra",
      identity: "identity",
    },
    mode: "live",
    generation,
    cold: false,
    resumeCold: false,
    recordIdentity: async () => {
      checkpoint = true;
    },
  });
  assert.equal(launched, true);
  assert.equal(checkpoint, true);
});

test("upgrade keeps infrastructure labels so Compose replaces only changed services", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "stand-upgrade-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const generation = randomUUID();
  /** @type {Record<string, unknown> | undefined} */
  let launchOptions;
  const runtime = createStandRuntime({
    directory,
    pnpmPath: "/fixture/pnpm",
    environment: {},
    run: async (args) => {
      if (args[0] === "context")
        return JSON.stringify("unix:///fixture/docker.sock");
      if (args[0] === "info") return "daemon";
      if (args[0] === "container") return "";
      return JSON.stringify({
        services: { api: {}, postgres: {}, logto: {}, "new-worker": {} },
      });
    },
    launch: async (options) => {
      launchOptions = options;
      assert.ok(options.composeOverride);
      const overlay = z
        .object({
          services: z.record(
            z.string(),
            z.object({ labels: z.record(z.string(), z.string()) }),
          ),
        })
        .parse(JSON.parse(await readFile(options.composeOverride, "utf8")));
      const label = (/** @type {string} */ service) =>
        overlay.services[service]?.labels["inside.local-stand.generation"];
      assert.equal(label("api"), generation);
      assert.equal(label("postgres"), "cold-generation");
      assert.equal(label("logto"), "cold-generation");
      assert.equal(label("new-worker"), generation);
    },
  });
  await runtime.inspect();
  const container = (/** @type {string} */ service) => ({
    id: `${service}-id`,
    service,
    image: "image",
    generation: service === "api" ? "refresh-generation" : "cold-generation",
    running: true,
    health: "healthy",
  });
  await runtime.prepare({
    source: {
      root: "/task",
      head: "head",
      fingerprint: "source",
      build: "build",
      schema: "schema",
      infrastructure: "infra",
      identity: "identity",
    },
    mode: "snapshot",
    generation,
    cold: false,
    resumeCold: false,
    upgrade: {
      daemon: "daemon",
      containers: ["api", "postgres", "logto"].map(container),
    },
    recordIdentity: async () => {},
  });
  assert.equal(launchOptions?.["upgrade"], true);
  assert.equal(launchOptions?.["refresh"], true);
});

test("backup dumps both databases into a private directory before an upgrade", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "stand-backup-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  /** @type {string[][]} */
  const dumps = [];
  const runtime = createStandRuntime({
    directory,
    pnpmPath: "/fixture/pnpm",
    environment: {},
    run: async (args) => {
      if (args[0] === "context")
        return JSON.stringify("unix:///fixture/docker.sock");
      if (args[0] === "info") return "daemon";
      if (args[0] === "container") return "";
      throw new Error(`Unexpected Docker call: ${args[0]}`);
    },
    dump: async (args, path) => {
      dumps.push(args);
      const { writeFile } = await import("node:fs/promises");
      await writeFile(path, "dump", { mode: 0o600 });
    },
  });
  await runtime.inspect();
  const container = (/** @type {string} */ service) => ({
    id: `${service}-id`,
    service,
    image: "image",
    generation: "g",
    running: true,
    health: "healthy",
  });
  const generation = randomUUID();
  const backup = await runtime.backup(
    {
      daemon: "daemon",
      containers: ["api", "postgres", "logto-postgres"].map(container),
    },
    generation,
  );
  assert.equal(backup, join(directory, "backups", generation));
  assert.deepEqual(
    dumps.map((args) => args.slice(0, 2)),
    [
      ["exec", "postgres-id"],
      ["exec", "logto-postgres-id"],
    ],
  );
  assert.ok(dumps.every((args) => args.join(" ").includes("pg_dumpall")));
  const { stat } = await import("node:fs/promises");
  assert.equal((await stat(backup)).mode & 0o777, 0o700);
  assert.equal(
    (await stat(join(backup, "postgres.sql.gz"))).mode & 0o777,
    0o600,
  );
  await assert.rejects(
    runtime.backup(
      { daemon: "daemon", containers: [container("api")] },
      randomUUID(),
    ),
    /postgres is not running/u,
  );
});
