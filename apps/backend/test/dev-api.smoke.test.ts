import type { ChildProcess } from "node:child_process";
import { spawnOwned, stopOwned } from "../../../scripts/owned-process.mjs";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

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

    const process = spawnOwned(
      globalThis.process.execPath,
      [pnpmPath, "dev:api"],
      {
        cwd: backendRoot,
        env: {
          ...globalThis.process.env,
          API_HOST: "127.0.0.1",
          API_PORT: String(port),
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    process.stdout?.on("data", (chunk: Buffer) =>
      output.push(chunk.toString()),
    );
    process.stderr?.on("data", (chunk: Buffer) =>
      output.push(chunk.toString()),
    );

    try {
      const response = await waitForResponse(
        `http://127.0.0.1:${port}/health`,
        process,
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
    } finally {
      await stopOwned(process);
    }
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
  return vi.waitFor(
    async () => {
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(`Development API exited early:\n${output.join("")}`);
      }
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      expect(response.status, output.join("")).toBe(200);
      return response;
    },
    { timeout: 10_000 },
  );
}
