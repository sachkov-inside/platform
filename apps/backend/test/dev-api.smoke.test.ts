import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("API development process", () => {
  let process: ChildProcess | undefined;

  afterEach(async () => {
    if (process?.pid === undefined || process.exitCode !== null) {
      return;
    }

    process.kill("SIGTERM");
    await new Promise<void>((resolveExit) => {
      process?.once("exit", () => resolveExit());
    });
  });

  it("serves health through the documented dev command", async () => {
    const port = await findAvailablePort();
    const output: string[] = [];
    const pnpmPath = globalThis.process.env.npm_execpath;

    if (pnpmPath === undefined) {
      throw new Error("npm_execpath is required to launch the pinned pnpm CLI");
    }

    process = spawn(globalThis.process.execPath, [pnpmPath, "dev:api"], {
      cwd: backendRoot,
      env: {
        ...globalThis.process.env,
        API_HOST: "127.0.0.1",
        API_PORT: String(port),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    process.stdout?.on("data", (chunk: Buffer) => output.push(chunk.toString()));
    process.stderr?.on("data", (chunk: Buffer) => output.push(chunk.toString()));

    const response = await waitForResponse(
      `http://127.0.0.1:${port}/health`,
      process,
      output,
    );

    expect(response.status, output.join("")).toBe(200);
    await expect(response.json()).resolves.toEqual({
      process: "api",
      status: "ok",
      database: "reachable",
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
  const deadline = Date.now() + 10_000;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Development API exited early:\n${output.join("")}`);
    }

    try {
      return await fetch(url);
    } catch {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    }
  }

  throw new Error(`Development API did not start:\n${output.join("")}`);
}
