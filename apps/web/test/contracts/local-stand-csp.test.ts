import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  watch,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { spawnOwned, stopOwned } from "../../../../scripts/owned-process.mjs";

const repositoryRoot = fileURLToPath(new URL("../../../..", import.meta.url));
const environmentSchema = z.record(z.string(), z.string().nullable());
const standConfigSchema = z.object({
  services: z.object({
    web: z.object({
      build: z.object({ args: environmentSchema.default({}) }),
    }),
    api: z.object({ environment: environmentSchema.default({}) }),
    mcp: z.object({ environment: environmentSchema.default({}) }),
  }),
});

async function standInput(
  storagePort?: string,
  productionWeb = true,
  adapter: {
    path?: string;
    timeoutMilliseconds?: number;
    signal?: AbortSignal;
  } = {},
) {
  const environment: NodeJS.ProcessEnv = {
    PATH: adapter.path ?? process.env["PATH"],
    NODE_ENV: "test",
    // Config rendering must work without any engine, live stand or registry operation.
    DOCKER_HOST: "unix:///1304-config-only-no-engine.sock",
    STAND_WEB_SOURCE_SHA: "1".repeat(40),
    ...(storagePort === undefined
      ? {}
      : { OBJECT_STORAGE_HOST_PORT: storagePort }),
  };
  // Compose only resolves checked-in source/config. It cannot read private stand env files.
  const child = spawnOwned(
    "docker",
    [
      "compose",
      "--project-name",
      "inside-platform-csp-config-contract",
      "--env-file",
      "/dev/null",
      "--file",
      "compose.yaml",
      "--file",
      "config/compose/local/learner-setup.compose.yaml",
      ...(productionWeb
        ? ["--file", "config/compose/local/production-web.compose.yaml"]
        : []),
      "--profile",
      "identity",
      "config",
      "--no-env-resolution",
      "--format",
      "json",
    ],
    {
      cwd: repositoryRoot,
      env: environment,
      timeout: adapter.timeoutMilliseconds ?? 20_000,
      ...(adapter.signal === undefined ? {} : { signal: adapter.signal }),
    },
  );
  try {
    let output = "";
    let diagnostic = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      diagnostic += chunk.toString();
    });
    const status = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", resolve);
    });
    if (status !== 0) throw new Error(`Compose config failed: ${diagnostic}`);
    return standConfigSchema.parse(JSON.parse(output)).services;
  } finally {
    await stopOwned(child);
  }
}

async function buildHeaders(
  origin?: string | null,
  mode: "production" | "development" = "production",
) {
  vi.stubEnv("NODE_ENV", mode);
  vi.stubEnv("CSP_LOCAL_OBJECT_STORAGE_ORIGIN", origin ?? "");
  vi.resetModules();
  return (await import("../../next.config")).default;
}

async function policy(config: Awaited<ReturnType<typeof buildHeaders>>) {
  const rules = (await config.headers?.()) ?? [];
  const value = rules
    .flatMap((rule) => rule.headers)
    .find((header) => header.key === "Content-Security-Policy")?.value;
  if (value === undefined) throw new Error("CSP header is missing");
  return value;
}

function localImageOrigins(value: string) {
  return value
    .split("; ")
    .find((part) => part.startsWith("img-src "))
    ?.split(" ")
    .filter((source) => source.startsWith("http://"));
}

describe("local stand production build input", () => {
  afterEach(() => vi.resetModules());

  it("admits exactly the configured storage origin through the real Compose and Next header boundary", async () => {
    const services = await standInput("9157");
    const config = await buildHeaders(
      services.web.build.args["CSP_LOCAL_OBJECT_STORAGE_ORIGIN"],
    );

    expect(localImageOrigins(await policy(config))).toEqual([
      "http://127.0.0.1:9157",
    ]);
    expect(services.api.environment["OBJECT_STORAGE_SIGNED_GET_ENDPOINT"]).toBe(
      "http://127.0.0.1:9157",
    );
    expect(services.mcp.environment["OBJECT_STORAGE_SIGNED_GET_ENDPOINT"]).toBe(
      "http://127.0.0.1:9157",
    );

    // Next captures config headers during build; a later runtime env change cannot repair them.
    vi.stubEnv("CSP_LOCAL_OBJECT_STORAGE_ORIGIN", "http://127.0.0.1:9167");
    expect(localImageOrigins(await policy(config))).toEqual([
      "http://127.0.0.1:9157",
    ]);
  });

  it("uses the default local storage port when no override was configured", async () => {
    const services = await standInput();
    const config = await buildHeaders(
      services.web.build.args["CSP_LOCAL_OBJECT_STORAGE_ORIGIN"],
    );
    expect(localImageOrigins(await policy(config))).toEqual([
      "http://127.0.0.1:9000",
    ]);
  });

  it("keeps development signed image URLs on the same configured published port", async () => {
    const services = await standInput("9157", false);
    const config = await buildHeaders(undefined, "development");
    expect(services.api.environment["OBJECT_STORAGE_SIGNED_GET_ENDPOINT"]).toBe(
      "http://127.0.0.1:9157",
    );
    expect(services.mcp.environment["OBJECT_STORAGE_SIGNED_GET_ENDPOINT"]).toBe(
      "http://127.0.0.1:9157",
    );
    expect(localImageOrigins(await policy(config))).toContain(
      "http://127.0.0.1:*",
    );
    expect(
      services.web.build.args["CSP_LOCAL_OBJECT_STORAGE_ORIGIN"],
    ).toBeUndefined();
  });

  it("declares the existing validated input only in the Next production build stage", () => {
    const dockerfile = readFileSync(
      new URL("../../Dockerfile", import.meta.url),
      "utf8",
    );
    const productionBuild = dockerfile
      .split("FROM development AS production-build\n")[1]
      ?.split("\nFROM ")[0];
    expect(productionBuild).toMatch(
      /^ARG CSP_LOCAL_OBJECT_STORAGE_ORIGIN=""$/mu,
    );
    expect(
      dockerfile.match(/^ARG CSP_LOCAL_OBJECT_STORAGE_ORIGIN/gmu),
    ).toHaveLength(1);
    expect(dockerfile).not.toMatch(/^ENV .*CSP_LOCAL_OBJECT_STORAGE_ORIGIN/mu);
  });
});

describe("Compose config process ownership", () => {
  async function blockedPlugin(interrupt: boolean) {
    const root = mkdtempSync(join(tmpdir(), "local-csp-process-contract-"));
    const controller = new AbortController();
    let running: Promise<unknown> | undefined;
    const observer = watch(root);
    try {
      mkdirSync(join(root, "bin"));
      const pidFile = join(root, "pid");
      writeFileSync(
        join(root, "bin/docker"),
        `#!/usr/bin/env node
import {spawn} from "node:child_process"; import {writeFileSync,renameSync} from "node:fs";
const plugin=spawn(process.execPath,["-e","process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:"ignore"});
writeFileSync(${JSON.stringify(pidFile + ".pending")},String(plugin.pid));renameSync(${JSON.stringify(pidFile + ".pending")},${JSON.stringify(pidFile)});
process.on("SIGTERM",()=>{});setInterval(()=>{},1000);
`,
        { mode: 0o755 },
      );
      // deterministic-test-allow duration-wait: bounds observing the fake Compose plugin's committed PID before cancellation.
      const readinessBudget = AbortSignal.timeout(5_000);
      const ready = new Promise<void>((resolve, reject) => {
        observer.on("change", (_event, name) => {
          if (name === "pid") resolve();
        });
        readinessBudget.addEventListener(
          "abort",
          () => {
            reject(new Error("Plugin PID barrier missing"));
          },
          { once: true },
        );
      });
      running = standInput(undefined, true, {
        path: `${join(root, "bin")}:${process.env["PATH"] ?? ""}`,
        timeoutMilliseconds: interrupt ? 20_000 : 1_000,
        signal: controller.signal,
      });
      // Attach rejection before the deliberately failing adapter can complete.
      const failure = running.catch((error: unknown) => error);
      await ready;
      const pid = Number(readFileSync(pidFile, "utf8"));
      if (interrupt) controller.abort();
      expect(await failure).toBeInstanceOf(Error);
      expect(() => process.kill(pid, 0)).toThrow();
    } finally {
      controller.abort();
      await running?.catch(() => undefined);
      observer.close();
      rmSync(root, { force: true, recursive: true });
    }
  }

  it("force-stops the Compose plugin tree after config timeout", async () => {
    await blockedPlugin(false);
  }, 15_000);

  it("force-stops the Compose plugin tree after caller cancellation", async () => {
    await blockedPlugin(true);
  }, 15_000);
});
