// @ts-check
import { createWriteStream } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { z } from "zod";
import { commandExit } from "./diagnostic-command.mjs";
import { launchLocalStand } from "./local-stand.mjs";
import {
  standApplicationServices,
  standDatabaseServices,
  standInfrastructureServices,
} from "./stand-services.mjs";
import { spawnOwned, stopOwned } from "./owned-process.mjs";
import { liveWebDirectories } from "./stand-source.mjs";

const apiReadinessBudgetMilliseconds = 5_000;
// A whole stand database dump; the stand holds product data, not media bytes.
const backupBudgetMilliseconds = 15 * 60_000;
const webReadinessBudgetMilliseconds = 10_000;
const project = "inside-platform";
const generationLabel = "inside.local-stand.generation";
const containerSchema = z.object({
  id: z.string().min(1),
  service: z.string(),
  image: z.string(),
  generation: z
    .string()
    .nullable()
    .transform((value) => value ?? ""),
  running: z.boolean(),
  health: z.string().nullable(),
});
const containerFormat = `{"id":{{json .Id}},"service":{{json (index .Config.Labels "com.docker.compose.service")}},"image":{{json .Image}},"generation":{{json (index .Config.Labels "${generationLabel}")}},"running":{{json .State.Running}},"health":{{with (index .State "Health")}}{{json .Status}}{{else}}null{{end}}}`;
const portSchema = z.record(
  z.string(),
  z.array(z.object({ HostIp: z.string(), HostPort: z.string() })).nullable(),
);

/**
 * @param {{ directory: string; pnpmPath: string; run?: (args: string[]) => Promise<string>; dump?: (args: string[], path: string) => Promise<void>; probe?: typeof fetch; environment?: NodeJS.ProcessEnv; launch?: typeof launchLocalStand }} options
 */
export function createStandRuntime({
  directory,
  pnpmPath,
  run,
  dump,
  probe = fetch,
  environment = process.env,
  launch = launchLocalStand,
}) {
  /** @type {string | undefined} */
  let dockerHost;
  const execute = run ?? ((args) => runDocker(args, dockerHost));
  const save = dump ?? ((args, path) => dumpDocker(args, path, dockerHost));
  const compose = (/** @type {string} */ sourceRoot) => [
    "compose",
    "--project-name",
    project,
    "--file",
    join(sourceRoot, "compose.yaml"),
    "--file",
    join(sourceRoot, "config/compose/local/learner-setup.compose.yaml"),
    "--file",
    join(sourceRoot, "config/compose/local/stand-kinescope.compose.yaml"),
    "--profile",
    "identity",
    "--profile",
    "local-accounts",
  ];

  async function inspect() {
    if (dockerHost === undefined) {
      const endpoint = z
        .string()
        .parse(
          JSON.parse(
            await execute([
              "context",
              "inspect",
              "--format",
              "{{json .Endpoints.docker.Host}}",
            ]),
          ),
        );
      const selected = environment["DOCKER_CONTEXT"]
        ? endpoint
        : environment["DOCKER_HOST"] || endpoint;
      if (!selected.startsWith("unix://"))
        throw new Error(
          "The stand controller requires a local Docker Unix socket",
        );
      dockerHost = selected;
    }
    const daemon = (await execute(["info", "--format", "{{.ID}}"])).trim();
    if (!daemon) throw new Error("Docker daemon identity is unavailable");
    const ids = (
      await execute([
        "container",
        "ls",
        "--all",
        "--quiet",
        "--no-trunc",
        "--filter",
        `label=com.docker.compose.project=${project}`,
      ])
    )
      .trim()
      .split(/\s+/u)
      .filter(Boolean);
    if (ids.length === 0) return { daemon, containers: [] };
    const output = await execute([
      "inspect",
      "--format",
      containerFormat,
      ...ids,
    ]);
    const containers = output
      .trim()
      .split("\n")
      .map((line) => containerSchema.parse(JSON.parse(line)));
    return { daemon, containers };
  }

  /** @param {import("./stand-controller.mjs").StandSnapshot} snapshot */
  async function ready(snapshot) {
    for (const service of [
      ...standApplicationServices,
      ...standInfrastructureServices,
    ]) {
      const container = snapshot.containers.find(
        (item) => item.service === service,
      );
      if (
        !container?.running ||
        (container.health !== null && container.health !== "healthy")
      )
        throw new Error(`Stand service ${service} is not ready`);
    }
    const api = snapshot.containers.find((item) => item.service === "api");
    const gateway = snapshot.containers.find(
      (item) => item.service === "local-accounts",
    );
    if (!api || !gateway) throw new Error("Stand entrypoints are missing");
    const apiUrl = await publishedUrl(api.id, "3001/tcp");
    const url = await publishedUrl(gateway.id);
    const response = await probe(`${apiUrl}/health`, {
      signal: AbortSignal.timeout(apiReadinessBudgetMilliseconds),
      redirect: "error",
    });
    if (!response.ok) throw new Error("Stand API readiness failed");
    const health = z
      .object({
        process: z.literal("api"),
        status: z.literal("ready"),
        database: z.literal("reachable"),
        schema: z.object({
          identity: z.string().startsWith("sha256:"),
          migrationCount: z.number().int().nonnegative(),
        }),
      })
      .parse(await response.json());
    const web = await probe(url, {
      signal: AbortSignal.timeout(webReadinessBudgetMilliseconds),
      redirect: "manual",
    });
    if (web.status < 200 || web.status >= 400)
      throw new Error("Stand Web readiness failed");
    await web.body?.cancel();
    return { schema: health.schema.identity, url };
  }

  /** @param {string} id @param {string} [port] */
  async function publishedUrl(id, port) {
    const ports = portSchema.parse(
      JSON.parse(
        await execute([
          "inspect",
          "--format",
          "{{json .NetworkSettings.Ports}}",
          id,
        ]),
      ),
    );
    const bindings =
      port === undefined
        ? Object.values(ports).flatMap((value) => value ?? [])
        : (ports[port] ?? []);
    const binding = bindings.find((value) => value.HostIp === "127.0.0.1");
    if (!binding)
      throw new Error("Stand entrypoint must be published on IPv4 loopback");
    const published = z.coerce
      .number()
      .int()
      .min(1)
      .max(65535)
      .parse(binding.HostPort);
    return `http://127.0.0.1:${published}`;
  }

  /** @param {import("./stand-controller.mjs").StandOperation} operation */
  async function prepare(operation) {
    if (dockerHost === undefined)
      throw new Error(
        "Inspect the local Docker endpoint before preparing the stand",
      );
    const config = z
      .object({ services: z.record(z.string(), z.unknown()) })
      .parse(
        JSON.parse(
          await execute([
            ...compose(operation.source.root),
            "config",
            "--no-env-resolution",
            "--format",
            "json",
          ]),
        ),
      );
    // An upgrade keeps infrastructure labels, so they do not force Compose to replace a service;
    // application roles always take the new generation.
    const retained = (/** @type {string} */ service) =>
      standApplicationServices.includes(service)
        ? undefined
        : operation.upgrade?.containers.find((item) => item.service === service)
            ?.generation;
    /** @type {Record<string, {labels: Record<string, string>; volumes?: {type: string; source: string; target: string; read_only: boolean; bind: {create_host_path: boolean}}[]}>} */
    const services = Object.fromEntries(
      Object.keys(config.services).map((service) => [
        service,
        {
          labels: {
            [generationLabel]: retained(service) || operation.generation,
          },
        },
      ]),
    );
    if (operation.mode === "live" && services["web"]) {
      services["web"].volumes = liveWebDirectories.map((path) => ({
        type: "bind",
        source: join(operation.source.root, path),
        target: `/workspace/${path}`,
        read_only: true,
        bind: { create_host_path: false },
      }));
    }
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const composeOverride = join(
      directory,
      `compose-${operation.generation}.json`,
    );
    await writeFile(composeOverride, JSON.stringify({ services }), {
      flag: "wx",
      mode: 0o600,
    });
    await launch({
      repositoryRoot: operation.source.root,
      pnpmPath,
      productionWeb: operation.mode === "production",
      refresh: !operation.cold,
      upgrade: operation.upgrade !== undefined,
      resumeCold: operation.resumeCold,
      composeOverride,
      logToStderr: true,
      dockerHost,
      onIdentityReady: operation.recordIdentity,
    });
  }

  /**
   * Dump every stand database cluster before an upgrade changes it. Restoring one is a separate
   * owner-directed operation (docs/runbooks/local-stand.md).
   * @param {import("./stand-controller.mjs").StandSnapshot} snapshot
   * @param {string} generation
   */
  async function backup(snapshot, generation) {
    const target = join(directory, "backups", generation);
    const containers = standDatabaseServices.map((service) => {
      const container = snapshot.containers.find(
        (item) => item.service === service,
      );
      if (!container?.running)
        throw new Error(`Stand database ${service} is not running`);
      return { service, id: container.id };
    });
    await mkdir(target, { recursive: true, mode: 0o700 });
    for (const { service, id } of containers)
      await save(
        [
          "exec",
          id,
          "sh",
          "-c",
          'exec pg_dumpall --clean --if-exists -U "$POSTGRES_USER"',
        ],
        join(target, `${service}.sql.gz`),
      );
    return target;
  }

  return { inspect, ready, prepare, backup };
}

/** @param {string[]} args @param {string} path @param {string | undefined} dockerHost */
async function dumpDocker(args, path, dockerHost) {
  const child = spawnOwned("docker", args, {
    timeout: backupBudgetMilliseconds,
    env: dockerEnvironment(dockerHost),
    stdio: ["ignore", "pipe", "pipe"],
  });
  // Database diagnostics may name roles or tables; report the status only.
  child.stderr?.resume();
  try {
    if (!child.stdout) throw new Error("Docker dump has no output stream");
    const [code] = await Promise.all([
      commandExit(child),
      pipeline(
        child.stdout,
        createGzip(),
        createWriteStream(`${path}.partial`, { flags: "wx", mode: 0o600 }),
      ),
    ]);
    if (code === 0) await rename(`${path}.partial`, path);
    if (code !== 0)
      throw new Error(`Stand database dump failed (${String(code)})`);
  } finally {
    await stopOwned(child);
  }
}

/** @param {string[]} args @param {string | undefined} dockerHost */
async function runDocker(args, dockerHost) {
  const child = spawnOwned("docker", args, {
    timeout: 20_000,
    env: dockerEnvironment(dockerHost),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout?.on("data", (/** @type {Buffer} */ value) => {
    output += value.toString();
  });
  // Diagnostics may contain resolved configuration. Return the operation and status only.
  child.stderr?.resume();
  try {
    const code = await commandExit(child);
    if (code !== 0)
      throw new Error(`Docker ${args[0]} failed (${String(code)})`);
    return output;
  } finally {
    await stopOwned(child);
  }
}

/** The verified local endpoint wins over the caller's Docker context. @param {string | undefined} dockerHost */
function dockerEnvironment(dockerHost) {
  return {
    ...process.env,
    ...(dockerHost ? { DOCKER_HOST: dockerHost, DOCKER_CONTEXT: "" } : {}),
  };
}
