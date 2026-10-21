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

/** @typedef {{fd:number,dev:bigint,ino:bigint,active:boolean}} PinFixtureDescriptor */
/**
 * Post-assertion rescue only; never supplies a pin while checking product behavior.
 * @param {typeof import("node:fs")} original
 * @param {{mock:{restore():void}}[]} patches
 * @param {()=>void} sync
 * @param {string} directory
 * @param {PinFixtureDescriptor[]} handles
 * @param {PinFixtureDescriptor[]} foreign
 * @param {boolean} primaryActive
 * @param {()=>void} [observe]
 */
function finishPinFixture(
  original,
  patches,
  sync,
  directory,
  handles,
  foreign,
  primaryActive,
  observe = () => {},
) {
  let failed = false;
  /** @type {unknown} */ let first;
  /** @param {()=>void} operation */
  const attempt = (operation) => {
    try {
      operation();
    } catch (error) {
      if (!failed) {
        failed = true;
        first = error;
      }
    }
  };
  for (const patch of patches.reverse()) attempt(() => patch.mock.restore());
  attempt(sync);
  /** @param {PinFixtureDescriptor[]} entries */
  const rescue = (entries) => {
    for (const entry of entries) {
      if (!entry.active) continue;
      entry.active = false;
      attempt(() => {
        let info;
        try {
          info = original.fstatSync(entry.fd, { bigint: true });
        } catch (error) {
          if (
            error instanceof Error &&
            "code" in error &&
            error.code === "EBADF"
          )
            return;
          throw error;
        }
        if (info.dev === entry.dev && info.ino === entry.ino)
          original.closeSync(entry.fd);
      });
    }
  };
  rescue(handles);
  attempt(observe);
  rescue(foreign);
  attempt(() => original.rmSync(directory, { recursive: true }));
  if (failed && !primaryActive) throw first;
}

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
  /** @type {PinFixtureDescriptor[]} */ const acquired = [];
  /** @type {Map<number,PinFixtureDescriptor>} */ const active = new Map();
  let primaryActive = false;
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
          const named = translated(path),
            fd = original.openSync(named, flags, mode);
          if (named === directory || named === directory + "/phase.json.new") {
            const info = original.fstatSync(fd, { bigint: true });
            const entry = { fd, dev: info.dev, ino: info.ino, active: true };
            acquired.push(entry);
            active.set(fd, entry);
          }
          return fd;
        },
      ),
    );
    patches.push(
      mock.method(fs.default, "closeSync", (/** @type {number} */ fd) => {
        const entry = active.get(fd);
        if (entry !== undefined) {
          entry.active = false;
          active.delete(fd);
        }
        original.closeSync(fd);
      }),
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
          live = acquired.some((entry) => {
            if (!entry.active) return false;
            try {
              const held = original.fstatSync(entry.fd, { bigint: true });
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
    assert.ok(
      acquired.every((entry) => !entry.active),
      "product descriptor close was skipped",
    );
    assert.equal(
      original.readFileSync(directory + "/phase.json.new", "utf8"),
      "foreign-recreated",
    );
    assert.equal(original.existsSync(directory + "/phase.json"), false);
  } catch (error) {
    primaryActive = true;
    throw error;
  } finally {
    finishPinFixture(
      original,
      patches,
      syncBuiltinESMExports,
      directory,
      acquired,
      [],
      primaryActive,
    );
  }
});

// deterministic-test-allow unit-io: actual owned FD acquisition/close faults in a private directory, with no provider or business runtime.
/** @param {string} fault @param {boolean} [skipClose] @param {{leaked?:PinFixtureDescriptor,ownClosed?:boolean,foreignPreserved?:boolean,originalError?:unknown}} [audit] */
async function runSdkPinFault(fault, skipClose = false, audit = {}) {
  const fs = await import("node:fs");
  const { syncBuiltinESMExports } = await import("node:module");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { mock } = await import("node:test");
  const original = { ...fs.default };
  const directory = original.realpathSync(
    original.mkdtempSync(join(tmpdir(), "inside-sdk-pin-fault-")),
  );
  /** @type {Map<number,PinFixtureDescriptor&{attempts:number,kind:string}>} */ const active =
    new Map();
  /** @type {(PinFixtureDescriptor&{attempts:number,kind:string})[]} */ const handles =
    [];
  /** @type {PinFixtureDescriptor[]} */ const foreign = [];
  let primaryActive = false;
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
            info = original.fstatSync(fd, { bigint: true }),
            entry = {
              fd,
              dev: info.dev,
              ino: info.ino,
              active: true,
              attempts: 0,
              kind,
            };
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
        entry.attempts++;
        if (skipClose && entry.kind === "pin") {
          audit.leaked = entry;
          return;
        }
        active.delete(fd);
        entry.active = false;
        retired.add(fd);
        original.closeSync(fd);
        if (fault === "writer_close" && entry.kind === "writer") {
          const foreignFd = original.openSync(
            directory + "/foreign-fd",
            original.constants.O_CREAT | original.constants.O_RDWR,
            0o600,
          );
          const info = original.fstatSync(foreignFd, { bigint: true });
          foreign.push({
            fd: foreignFd,
            dev: info.dev,
            ino: info.ino,
            active: true,
          });
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
    for (const entry of foreign) {
      original.fstatSync(entry.fd);
      assert.ok(
        retired.has(entry.fd),
        "controlled retired-number reuse missing",
      );
    }
    assert.equal(
      original.existsSync(directory + "/phase.json"),
      fault === "pin_close",
    );
  } catch (error) {
    primaryActive = true;
    audit.originalError = error;
    throw error;
  } finally {
    finishPinFixture(
      original,
      patches,
      syncBuiltinESMExports,
      directory,
      handles,
      foreign,
      primaryActive,
      () => {
        if (audit.leaked !== undefined) {
          try {
            original.fstatSync(audit.leaked.fd);
            audit.ownClosed = false;
          } catch (error) {
            audit.ownClosed =
              error instanceof Error &&
              "code" in error &&
              error.code === "EBADF";
          }
          audit.foreignPreserved = foreign.every((entry) => {
            try {
              const info = original.fstatSync(entry.fd, { bigint: true });
              return info.dev === entry.dev && info.ino === entry.ino;
            } catch {
              return false;
            }
          });
        }
      },
    );
  }
}

// deterministic-test-allow unit-io: actual owned FD acquisition/close faults in a private directory, with no provider or business runtime.
test("SDK pin faults attempt every close and cannot retire a foreign reused descriptor", async () => {
  for (const fault of ["pin_open", "writer_close", "combined", "pin_close"])
    await runSdkPinFault(fault);
});

// deterministic-test-allow unit-io: intentionally omitted product close must fail its assertion before fixture rescue; real descriptors only.
test("SDK failed pin fixture rescues its skipped close and preserves the retired-number foreign handle", async () => {
  const original = await import("node:fs");
  /** @type {{leaked?:PinFixtureDescriptor,ownClosed?:boolean,foreignPreserved?:boolean,originalError?:unknown}} */ const audit =
    {};
  let primaryActive = false;
  try {
    await assert.rejects(
      runSdkPinFault("writer_close", true, audit),
      (error) =>
        error === audit.originalError && error instanceof assert.AssertionError,
    );
    assert.equal(
      audit.ownClosed,
      true,
      "failed fixture left its product descriptor open",
    );
    assert.equal(
      audit.foreignPreserved,
      true,
      "fixture rescue touched a retired-number foreign descriptor",
    );
  } catch (error) {
    primaryActive = true;
    throw error;
  } finally {
    if (audit.leaked !== undefined && audit.leaked.active) {
      audit.leaked.active = false;
      try {
        let info;
        try {
          info = original.fstatSync(audit.leaked.fd, { bigint: true });
        } catch (error) {
          if (
            error instanceof Error &&
            "code" in error &&
            error.code === "EBADF"
          )
            info = undefined;
          else throw error;
        }
        if (
          info !== undefined &&
          info.dev === audit.leaked.dev &&
          info.ino === audit.leaked.ino
        )
          original.closeSync(audit.leaked.fd);
      } catch (error) {
        if (!primaryActive) throw error;
      }
    }
  }
});
