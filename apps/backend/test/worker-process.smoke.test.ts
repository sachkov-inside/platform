import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";

import { afterEach, describe, expect, it } from "vitest";

describe("worker process smoke", () => {
  let worker: ChildProcessWithoutNullStreams | undefined;

  afterEach(async () => {
    if (worker?.exitCode === null && worker.signalCode === null) {
      worker.kill("SIGKILL");
      await once(worker, "exit");
    }
  });

  it("starts PgBoss and Platform lifecycles and stops cleanly", async () => {
    worker = spawn(
      process.execPath,
      ["--import", "tsx", "src/entrypoints/worker.ts"],
      {
        cwd: process.cwd(),
        env: { ...process.env, NODE_ENV: "test" },
      },
    );

    const readinessOutput = await waitForOutput(
      worker,
      '"process":"worker","status":"ok","database":"reachable"',
    );
    expect(readinessOutput).toContain('"process":"worker"');

    worker.kill("SIGTERM");
    const [exitCode, signal] = await once(worker, "exit");

    expect(exitCode).toBe(0);
    expect(signal).toBeNull();
  });
});

function waitForOutput(
  child: ChildProcessWithoutNullStreams,
  expected: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (stdout.includes(expected)) {
        resolve(stdout);
      }
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("exit", (code, signal) => {
      reject(
        new Error(
          `worker exited before readiness (code=${String(code)}, signal=${String(signal)}): ${stderr}`,
        ),
      );
    });
  });
}
