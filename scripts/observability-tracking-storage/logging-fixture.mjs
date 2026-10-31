// @ts-check
// Real compiled HTTP completion/log caller; no Nest app, PostgreSQL or collector claim.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { Writable } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";
import { writeProducerWitness } from "./producer.mjs";
const root = fileURLToPath(new URL("../../", import.meta.url));
const require = createRequire(
  new URL("../../apps/backend/package.json", import.meta.url),
);
// oxlint-disable typescript/no-unsafe-type-assertion -- This test loads the pinned backend Fastify package; its owner exports the dependency type.
const fastify =
  /** @type {typeof import("../../apps/backend/test/support/proof-dependencies.js").fastify} */ (
    require("fastify")
  );
// oxlint-enable typescript/no-unsafe-type-assertion
/** @type {typeof import("../../apps/backend/src/infrastructure/observability/http-request-log.js")} */
// oxlint-disable-next-line typescript/no-unsafe-assignment -- Fixed freshly compiled production caller, bound by source inputs and compiled-byte proof.
const production = await import(
  pathToFileURL(
    resolve(
      root,
      "apps/backend/dist/infrastructure/observability/http-request-log.js",
    ),
  ).href
);
let bytes = 0;
let completions = 0;
const diagnostics = new Writable({
  write(/** @type {Buffer} */ chunk, _encoding, done) {
    try {
      bytes += Buffer.byteLength(chunk);
      assert.ok(bytes <= 65536);
      /** @type {unknown} */
      const value = JSON.parse(String(chunk));
      assert.ok(
        value !== null && typeof value === "object" && "event" in value,
      );
      assert.equal(value.event, "request_completed");
      completions++;
      done();
    } catch {
      done(new Error("closed diagnostic contract failure"));
    }
  },
});
// Consume private stream errors without printing their data; a failed count refuses the witness.
let diagnosticFailure = false;
diagnostics.on("error", () => {
  diagnosticFailure = true;
});
const originalConsole = globalThis.console;
const rejectWork = process.argv[2] === "reject-work";
try {
  await writeProducerWitness(async () => {
    const app = fastify({ logger: false });
    try {
      production.observeHttpRequests(app, "api");
      app.get("/tracking-logging-proof", () => ({ ok: true }));
      await app.listen({ host: "127.0.0.1", port: 0 });
      const address = app.server.address();
      assert.ok(address !== null && typeof address !== "string");
      const response = await fetch(
        `http://127.0.0.1:${address.port}/tracking-logging-proof?token=private_tracking_logging_sentinel`,
        { signal: AbortSignal.timeout(2000) },
      );
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { ok: true });
    } finally {
      await app.close();
    }
    assert.equal(diagnosticFailure, false);
    if (rejectWork)
      throw new Error("private_tracking_logging_failure_sentinel");
    return { schema: 1, http: "passed", private_log_count: completions };
  }, diagnostics);
  assert.equal(globalThis.console, originalConsole);
} catch {
  if (
    rejectWork &&
    globalThis.console === originalConsole &&
    completions === 1 &&
    !diagnosticFailure
  ) {
    process.stdout.write(
      JSON.stringify({
        schema: 1,
        rejected_work: "passed",
        console_restored: "passed",
        private_log_count: completions,
      }),
    );
  } else {
    process.stderr.write("tracking-logging-fixture: closed failure\n");
    process.exitCode = 1;
  }
} finally {
  diagnostics.destroy();
}
