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

// deterministic-test-allow unit-io: genuine owned directory-FD writer with no path shim; unsupported Mac anchoring remains absent.
test("SDK genuine phase anchoring follows the host capability without a path fallback", async () => {
  const fs = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { createSdkEmitterPhase } = await import("./emitter-phase.mjs");
  const directory = fs.realpathSync(
    fs.mkdtempSync(join(tmpdir(), "inside-sdk-phase-anchor-")),
  );
  const file = directory + "/phase.json";
  try {
    const phase = createSdkEmitterPhase({
      INSIDE_SDK_EMITTER_PHASE_PATH: file,
      INSIDE_SDK_EMITTER_PHASE_SOURCE: "a".repeat(40),
    });
    if (process.platform === "darwin") {
      assert.equal(
        phase,
        null,
        "unsupported genuine directory traversal must disable observation",
      );
      assert.equal(fs.existsSync(file), false);
    } else {
      assert.ok(
        phase !== null,
        "Linux source route requires a genuine anchored owner",
      );
      phase.enter("input_validation");
      phase.failed();
      assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), {
        schema: 1,
        scope: "sdk",
        source: "a".repeat(40),
        state: "failed",
        phase: "input_validation",
        reason: "operation_failed",
      });
    }
  } finally {
    fs.rmSync(directory, { recursive: true });
  }
});

// deterministic-test-allow unit-io: actual product-owned file descriptors and controlled owned-directory rename refusal; FD-path shim on Mac is not Linux anchoring evidence.
test("SDK writer pins its original temporary inode through rename failure cleanup", async () => {
  const fs = await import("node:fs");
  const { syncBuiltinESMExports } = await import("node:module");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { mock } = await import("node:test");
  const original = { ...fs.default };
  const directory = original.realpathSync(
    original.mkdtempSync(join(tmpdir(), "inside-sdk-pin-")),
  );
  /** @type {number[]} */ const acquired = [];
  const patches = [];
  let live = false;
  /** @param {import("node:fs").PathLike} path */
  const translated = (path) =>
    process.platform !== "linux" &&
    typeof path === "string" &&
    /^\/proc\/self\/fd\/[0-9]+(?:\/|$)/u.test(path)
      ? directory + path.replace(/^\/proc\/self\/fd\/[0-9]+/u, "")
      : path;
  try {
    for (const name of /** @type {const} */ ([
      "realpathSync",
      "statSync",
      "lstatSync",
      "unlinkSync",
    ])) {
      patches.push(
        mock.method(fs.default, name, (/** @type {unknown[]} */ ...args) => {
          /** @type {unknown} */ const result = Reflect.apply(
            Reflect.get(original, name),
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
        "openSync",
        (
          /** @type {import("node:fs").PathLike} */ path,
          /** @type {number|string} */ flags,
          /** @type {import("node:fs").Mode|undefined} */ mode,
        ) => {
          const fd = original.openSync(translated(path), flags, mode);
          acquired.push(fd);
          return fd;
        },
      ),
    );
    patches.push(
      mock.method(
        fs.default,
        "renameSync",
        (
          /** @type {import("node:fs").PathLike} */ from,
          /** @type {import("node:fs").PathLike} */ _to,
        ) => {
          const path = translated(from),
            info = original.lstatSync(path, { bigint: true });
          live = acquired.some((fd) => {
            try {
              const held = original.fstatSync(fd, { bigint: true });
              return held.dev === info.dev && held.ino === info.ino;
            } catch {
              return false;
            }
          });
          original.unlinkSync(path);
          original.writeFileSync(path, "foreign-recreated", { mode: 0o600 });
          throw new Error("controlled rename refusal");
        },
      ),
    );
    syncBuiltinESMExports();
    const { createSdkEmitterPhase } = await import("./emitter-phase.mjs");
    const phase = createSdkEmitterPhase({
      INSIDE_SDK_EMITTER_PHASE_PATH: directory + "/phase.json",
      INSIDE_SDK_EMITTER_PHASE_SOURCE: "a".repeat(40),
    });
    assert.ok(phase !== null);
    phase.enter("input_validation");
    phase.failed();
    assert.equal(
      live,
      true,
      "writer released original temp before named cleanup",
    );
    for (const fd of acquired) assert.throws(() => original.fstatSync(fd));
    assert.equal(
      original.readFileSync(directory + "/phase.json.new", "utf8"),
      "foreign-recreated",
    );
    assert.equal(original.existsSync(directory + "/phase.json"), false);
  } finally {
    for (const patch of patches.reverse()) patch.mock.restore();
    syncBuiltinESMExports();
    original.rmSync(directory, { recursive: true });
  }
});

// deterministic-test-allow unit-io: actual owned FD acquisition/close faults in a private directory, with no provider or business runtime.
test("SDK pin faults attempt every close and cannot retire a foreign reused descriptor", async () => {
  const fs = await import("node:fs");
  const { syncBuiltinESMExports } = await import("node:module");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { mock } = await import("node:test");
  for (const fault of ["pin_open", "writer_close", "combined", "pin_close"]) {
    const original = { ...fs.default };
    const directory = original.realpathSync(
      original.mkdtempSync(join(tmpdir(), "inside-sdk-pin-fault-")),
    );
    /** @type {Map<number,{attempts:number,kind:string}>} */ const active =
      new Map();
    /** @type {{attempts:number,kind:string}[]} */ const handles = [];
    /** @type {number[]} */ const foreign = [];
    const patches = [];
    let unknownClose = false;
    /** @type {Set<number>} */ const retired = new Set();
    /** @param {import("node:fs").PathLike} path */
    const translated = (path) =>
      process.platform !== "linux" &&
      typeof path === "string" &&
      /^\/proc\/self\/fd\/[0-9]+(?:\/|$)/u.test(path)
        ? directory + path.replace(/^\/proc\/self\/fd\/[0-9]+/u, "")
        : path;
    try {
      for (const name of /** @type {const} */ ([
        "realpathSync",
        "statSync",
        "lstatSync",
      ]))
        patches.push(
          mock.method(fs.default, name, (/** @type {unknown[]} */ ...args) => {
            /** @type {unknown} */ const result = Reflect.apply(
              Reflect.get(original, name),
              fs.default,
              [
                typeof args[0] === "string" ? translated(args[0]) : args[0],
                ...args.slice(1),
              ],
            );
            return result;
          }),
        );
      patches.push(
        mock.method(
          fs.default,
          "openSync",
          (
            /** @type {import("node:fs").PathLike} */ path,
            /** @type {number|string} */ flags,
            /** @type {import("node:fs").Mode|undefined} */ mode,
          ) => {
            const named = translated(path);
            if (named !== directory && named !== directory + "/phase.json.new")
              return original.openSync(named, flags, mode);
            const kind =
              named === directory
                ? "parent"
                : typeof flags === "number" &&
                    (flags & original.constants.O_WRONLY) !== 0
                  ? "writer"
                  : "pin";
            if (kind === "pin" && fault === "pin_open")
              throw new Error("controlled pin open refusal");
            const fd = original.openSync(named, flags, mode),
              entry = { attempts: 0, kind };
            active.set(fd, entry);
            handles.push(entry);
            return fd;
          },
        ),
      );
      patches.push(
        mock.method(fs.default, "closeSync", (/** @type {number} */ fd) => {
          const entry = active.get(fd);
          if (entry === undefined) {
            if (retired.has(fd)) unknownClose = true;
            original.closeSync(fd);
            return;
          }
          active.delete(fd);
          retired.add(fd);
          entry.attempts++;
          original.closeSync(fd);
          if (fault === "writer_close" && entry.kind === "writer") {
            foreign.push(
              original.openSync(
                directory + "/foreign-fd",
                original.constants.O_CREAT | original.constants.O_RDWR,
                0o600,
              ),
            );
            throw new Error("controlled writer close refusal");
          }
          if (
            (fault === "pin_close" && entry.kind === "pin") ||
            (fault === "combined" && entry.kind !== "writer")
          )
            throw new Error("controlled close refusal");
        }),
      );
      patches.push(
        mock.method(
          fs.default,
          "renameSync",
          (
            /** @type {import("node:fs").PathLike} */ from,
            /** @type {import("node:fs").PathLike} */ to,
          ) => {
            if (fault === "combined")
              throw new Error("controlled rename refusal");
            original.renameSync(translated(from), translated(to));
          },
        ),
      );
      patches.push(
        mock.method(
          fs.default,
          "unlinkSync",
          (/** @type {import("node:fs").PathLike} */ path) => {
            if (fault === "combined")
              throw new Error("controlled unlink refusal");
            original.unlinkSync(translated(path));
          },
        ),
      );
      syncBuiltinESMExports();
      const { createSdkEmitterPhase } = await import("./emitter-phase.mjs");
      const phase = createSdkEmitterPhase({
        INSIDE_SDK_EMITTER_PHASE_PATH: directory + "/phase.json",
        INSIDE_SDK_EMITTER_PHASE_SOURCE: "a".repeat(40),
      });
      assert.ok(phase !== null);
      phase.enter("input_validation");
      const count = handles.length;
      phase.failed();
      assert.equal(
        handles.length,
        count,
        "failed observer admitted later writes",
      );
      assert.equal(unknownClose, false, "retired descriptor was retried");
      assert.ok(
        handles.every((entry) => entry.attempts === 1),
        "an acquired close was skipped",
      );
      assert.equal(active.size, 0);
      for (const fd of foreign) original.fstatSync(fd);
      assert.equal(
        original.existsSync(directory + "/phase.json"),
        fault === "pin_close",
      );
    } finally {
      for (const patch of patches.reverse()) patch.mock.restore();
      syncBuiltinESMExports();
      for (const fd of foreign) original.closeSync(fd);
      original.rmSync(directory, { recursive: true });
    }
  }
});
