// @ts-check
import assert from "node:assert/strict";
import { execFile, fork } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { test } from "node:test";
import { z } from "zod";

const webRoot = fileURLToPath(new URL("../apps/web/", import.meta.url));
const fixtures = new URL(
  "../apps/web/test/fixtures/storybook-runner/",
  import.meta.url,
);
const run = promisify(execFile);

test("Storybook delivers IPC reports without retaining their history", async () => {
  const { stdout } = await run(
    process.execPath,
    [
      "--experimental-test-module-mocks",
      fileURLToPath(new URL("ipc-parent.mjs", fixtures)),
    ],
    { cwd: webRoot, timeout: 10000 },
  );
  const result = z
    .object({ delivered: z.number(), buffered: z.number() })
    .parse(JSON.parse(stdout.trim()));
  assert.equal(result.delivered, 16);
  assert.equal(
    result.buffered,
    0,
    "Execa must not keep past Vitest reports in ipcOutput",
  );
});

test("Storybook Vitest exits when its parent's IPC connection disappears", async () => {
  const child = fork(
    fileURLToPath(new URL("disconnect-child.mjs", fixtures)),
    [],
    {
      cwd: webRoot,
      execArgv: ["--experimental-test-module-mocks"],
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    },
  );
  let stderr = "";
  child.stderr?.on("data", (chunk) => {
    stderr += String(chunk);
  });
  const timeout = AbortSignal.timeout(10000);
  try {
    const exited = once(child, "exit", { signal: timeout });
    await once(child, "message", { signal: timeout });
    child.disconnect();
    await exited;
    assert.equal(child.exitCode, 0, stderr);
    assert.equal(child.signalCode, null);
  } finally {
    child.kill("SIGKILL");
  }
});
