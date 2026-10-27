// @ts-check
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { commandExit } from "./diagnostic-command.mjs";
import { launchLocalStand } from "./local-stand.mjs";
import { standApplicationServices } from "./stand-services.mjs";
import { spawnOwned, stopOwned } from "./owned-process.mjs";
import { liveWebDirectories } from "./stand-source.mjs";

const apiReadinessBudgetMilliseconds = 5_000;
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
 * @param {{ directory: string; pnpmPath: string; run?: (args: string[]) => Promise<string>; probe?: typeof fetch; environment?: NodeJS.ProcessEnv; launch?: typeof launchLocalStand }} options
 */
export function createStandRuntime({
  directory,
  pnpmPath,
  run,
  probe = fetch,
  environment = process.env,
  launch = launchLocalStand,
}) {
  /** @type {string | undefined} */
  let dockerHost;
  const execute = run ?? ((args) => runDocker(args, dockerHost));
  const compose = (/** @type {string} */ sourceRoot) => [
    "compose",
    "--project-name",
    project,
    "--file",
    join(sourceRoot, "compose.yaml"),
    "--file",
    join(sourceRoot, "config/compose/local/learner-setup.compose.yaml"),
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
      "postgres",
      "object-storage",
      "rabbitmq",
      "logto",
      "logto-postgres",
      "mailpit",
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
    /** @type {Record<string, {labels: Record<string, string>; volumes?: {type: string; source: string; target: string; read_only: boolean; bind: {create_host_path: boolean}}[]}>} */
    const services = Object.fromEntries(
      Object.keys(config.services).map((service) => [
        service,
        { labels: { [generationLabel]: operation.generation } },
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
      resumeCold: operation.resumeCold,
      composeOverride,
      logToStderr: true,
      dockerHost,
      onIdentityReady: operation.recordIdentity,
    });
  }

  return { inspect, ready, prepare };
}

/** @param {string[]} args @param {string | undefined} dockerHost */
async function runDocker(args, dockerHost) {
  const child = spawnOwned("docker", args, {
    timeout: 20_000,
    env: {
      ...process.env,
      ...(dockerHost ? { DOCKER_HOST: dockerHost, DOCKER_CONTEXT: "" } : {}),
    },
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
