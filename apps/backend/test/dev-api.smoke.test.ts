import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { onTestFinished, describe, expect, it } from "vitest";

import { signalProcessGroup } from "../../../scripts/process-group-signal.mjs";

import { platformMigrations } from "../src/migrations/index.js";
import { stringMatching } from "./support/matchers.js";

const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("API development process", () => {
  it("serves health through the documented dev command", async () => {
    const port = await findAvailablePort();
    const output: string[] = [];
    const pnpmPath = globalThis.process.env["npm_execpath"];

    if (pnpmPath === undefined) {
      throw new Error("npm_execpath is required to launch the pinned pnpm CLI");
    }

    // The hook owns normal test exits. Forced cleanup across pnpm's separate descendant
    // groups and supervision after runner SIGKILL remain tracked in #1154.
    const child = spawn(globalThis.process.execPath, [pnpmPath, "dev:api"], {
      detached: true,
      cwd: backendRoot,
      env: {
        ...globalThis.process.env,
        API_HOST: "127.0.0.1",
        API_PORT: String(port),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    onTestFinished(async () => {
      const closed =
        child.exitCode === null && child.signalCode === null
          ? once(child, "close", { signal: AbortSignal.timeout(5_000) })
          : undefined;
      try {
        // pnpm forwards SIGTERM to the separate group it creates for the dev script.
        child.kill("SIGTERM");
        await closed;
      } finally {
        if (child.pid !== undefined) signalProcessGroup(child.pid, "SIGKILL");
      }
    });
    child.stdout.on("data", (chunk: Buffer) => output.push(chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => output.push(chunk.toString()));

    const response = await waitForResponse(
      `http://127.0.0.1:${port}/health`,
      child,
      output,
    );

    expect(response.status, output.join("")).toBe(200);
    await expect(response.json()).resolves.toEqual({
      database: "reachable",
      process: "api",
      release: {
        release: "development",
        sourceSha: "0000000000000000000000000000000000000000",
      },
      schema: {
        identity: stringMatching(/^sha256:[0-9a-f]{64}$/u),
        migrationCount: platformMigrations.length,
      },
      status: "ready",
    });
  });
});

async function findAvailablePort(): Promise<number> {
  const server = createServer();

  return new Promise<number>((resolvePort, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate a local TCP port"));
        return;
      }

      server.close((error) => {
        if (error !== undefined) {
          reject(error);
          return;
        }
        resolvePort(address.port);
      });
    });
  });
}

async function waitForResponse(
  url: string,
  child: ChildProcess,
  output: readonly string[],
): Promise<Response> {
  const deadline = performance.now() + 10_000;

  while (performance.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Development API exited early:\n${output.join("")}`);
    }

    try {
      return await fetch(url);
    } catch {
      // deterministic-test-allow duration-wait: Poll the live health response; the delay is only the sampling interval.
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    }
  }

  throw new Error(`Development API did not start:\n${output.join("")}`);
}
