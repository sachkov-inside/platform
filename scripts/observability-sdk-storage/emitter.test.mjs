// @ts-check
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { test } from "node:test";
import { emit } from "./emitter.mjs";

// deterministic-test-allow unit-io: native production SDK/S3/OTLP owned loopback contract, no external provider or Docker.
test("production SDK cold read emits through native OTLP and closes its provider listener", async (owner) => {
  /** @type {string[]} */
  const paths = [];
  const server = createServer((request, response) => {
    paths.push(request.url ?? "");
    let bytes = 0;
    request.on("data", (/** @type {Buffer} */ chunk) => {
      bytes += chunk.length;
      if (bytes > 262144) request.destroy();
    });
    request.on("end", () =>
      response.writeHead(200, { "content-type": "application/json" }).end("{}"),
    );
  });
  owner.after(async () => {
    server.closeAllConnections();
    if (server.listening)
      await new Promise((resolve, reject) =>
        server.close((error) =>
          error === undefined ? resolve(undefined) : reject(error),
        ),
      );
    assert.equal(server.listening, false);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address !== null && typeof address !== "string");
  const witness = await emit(
    `http://127.0.0.1:${address.port}`,
    "a".repeat(40),
  );
  assert.equal(witness.schema, 2);
  assert.equal(witness.provider_requests, 1);
  assert.equal(witness.body_read, "passed");
  assert.match(String(witness.trace_id), /^[0-9a-f]{32}$/u);
  assert.match(String(witness.root_id), /^[0-9a-f]{16}$/u);
  assert.ok(paths.includes("/v1/traces"));
  assert.ok(paths.includes("/v1/metrics"));
  assert.ok(
    witness.runtime_modules
      .map((row) => row.path)
      .some((name) => name.includes("@aws-sdk/client-s3")),
  );
  assert.ok(
    witness.runtime_modules
      .map((row) => row.path)
      .some((name) => name.includes("@opentelemetry/exporter-trace-otlp-http")),
  );
  assert.ok(
    witness.runtime_modules
      .map((row) => row.sha256)
      .every((hash) => /^[0-9a-f]{64}$/u.test(hash)),
  );
});

// deterministic-test-allow unit-io: fixed diagnostic factory validates owned private paths, no runtime/provider/PG.
test("SDK phase admission never invokes foreign getters and unsupported FD traversal is absent", async () => {
  const { createSdkEmitterPhase, admitSdkEmitterPhase } =
    await import("./emitter-phase.mjs");
  let touched = false;
  const hostile = new Proxy(
    {},
    {
      get() {
        touched = true;
        throw new Error("synthetic getter");
      },
      getPrototypeOf() {
        touched = true;
        throw new Error("synthetic prototype");
      },
    },
  );
  assert.equal(admitSdkEmitterPhase(hostile), null);
  assert.equal(touched, false);
  for (const environment of [
    undefined,
    null,
    {},
    { INSIDE_SDK_EMITTER_PHASE_SOURCE: "a".repeat(40) },
    {
      INSIDE_SDK_EMITTER_PHASE_PATH: "/tmp/phase.json",
      INSIDE_SDK_EMITTER_PHASE_SOURCE: "private",
    },
  ])
    assert.equal(createSdkEmitterPhase(environment), null);
});

// deterministic-test-allow unit-io: FD-path translation is a controlled library seam on an owned temp only. It is not OS anchoring or native SDK evidence.
test("SDK input failure keeps its original error and commits the owning phase through a controlled FD seam", async () => {
  const fs = await import("node:fs");
  const { syncBuiltinESMExports } = await import("node:module");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { mock } = await import("node:test");
  const directory = fs.realpathSync(
    fs.mkdtempSync(join(tmpdir(), "inside-sdk-emitter-phase-control-")),
  );
  const file = directory + "/phase.json";
  const originals = {
    realpathSync: fs.default.realpathSync,
    statSync: fs.default.statSync,
    lstatSync: fs.default.lstatSync,
    openSync: fs.default.openSync,
    renameSync: fs.default.renameSync,
    unlinkSync: fs.default.unlinkSync,
  };
  /** @param {import("node:fs").PathLike} path */
  const translated = (path) =>
    typeof path === "string" && /^\/proc\/self\/fd\/[0-9]+(?:\/|$)/u.test(path)
      ? directory + path.replace(/^\/proc\/self\/fd\/[0-9]+/u, "")
      : path;
  const patches = [];
  try {
    // Only virtual descriptor paths are translated; ordinary real parent ownership checks remain actual.
    for (const name of /** @type {const} */ ([
      "realpathSync",
      "statSync",
      "lstatSync",
      "openSync",
      "unlinkSync",
    ])) {
      patches.push(
        mock.method(fs.default, name, (/** @type {unknown[]} */ ...args) => {
          /** @type {unknown} */ const result = Reflect.apply(
            Reflect.get(originals, name),
            fs.default,
            [
              typeof args[0] === "string" ? translated(args[0]) : args[0],
              ...args.slice(1),
            ],
          );
          return result;
        }),
      );
    }
    patches.push(
      mock.method(
        fs.default,
        "renameSync",
        (
          /** @type {import("node:fs").PathLike} */ from,
          /** @type {import("node:fs").PathLike} */ to,
        ) => originals.renameSync(translated(from), translated(to)),
      ),
    );
    syncBuiltinESMExports();
    const { createSdkEmitterPhase } = await import("./emitter-phase.mjs");
    const phase = createSdkEmitterPhase({
      INSIDE_SDK_EMITTER_PHASE_PATH: file,
      INSIDE_SDK_EMITTER_PHASE_SOURCE: "a".repeat(40),
    });
    assert.notEqual(phase, null, "controlled owning observer missing");
    let failed = false;
    try {
      await emit("invalid", "a".repeat(40), phase);
    } catch (error) {
      failed = error instanceof assert.AssertionError;
    }
    assert.equal(failed, true, "producer input result changed");
    assert.equal(fs.existsSync(file), true, "own phase marker missing");
    /** @type {unknown} */
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.deepEqual(value, {
      schema: 1,
      scope: "sdk",
      source: "a".repeat(40),
      state: "failed",
      phase: "input_validation",
      reason: "operation_failed",
    });
  } finally {
    for (const patch of patches.reverse()) patch.mock.restore();
    syncBuiltinESMExports();
    fs.rmSync(directory, { recursive: true });
  }
});
