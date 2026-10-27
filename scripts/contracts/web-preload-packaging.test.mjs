// @ts-check
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runOwnedProcess } from "../observability-umami/process-owner.mjs";
import { copyProductionWebPreload } from "../../apps/web/scripts/copy-production-web-preload.mjs";

// deterministic-test-allow unit-io: replay real production COPY inputs in an owned OS temporary directory, run bounded native Node, and remove the entire directory in finally.
test("production Web preload resolves its dependencies outside the workspace with metrics disabled", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inside-web-preload-"));
  try {
    // Standalone is intentionally absent: preload-only dependencies must be explicit
    // image inputs rather than accidentally available through the checkout's parents.
    await copyProductionWebPreload(directory);
    const result = await runOwnedProcess(
      "/usr/bin/env",
      [
        "-i",
        "INSIDE_WEB_HTTP_METRICS_ENABLED=false",
        process.execPath,
        "--import",
        join(directory, "apps/web/web-http-preload.mjs"),
        "--input-type=module",
        "-e",
        'process.stdout.write("preload-ready\\n")',
      ],
      { timeoutMs: 5000 },
    );
    assert.equal(result.reason, "exit");
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout, "preload-ready\n");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
