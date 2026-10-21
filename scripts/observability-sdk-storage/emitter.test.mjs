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
 * @param {string|undefined} directory
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
  if (directory !== undefined)
    attempt(() => original.rmSync(directory, { recursive: true }));
  if (failed && !primaryActive) throw first;
}

/** @param {typeof import("node:fs")} original @param {import("node:fs").PathLike} path @param {number|string} flags @param {import("node:fs").Mode|undefined} [mode] @returns {PinFixtureDescriptor} */
function openPinFixtureDescriptor(original, path, flags, mode) {
  const fd = original.openSync(path, flags, mode);
  try {
    const info = original.fstatSync(fd, { bigint: true });
    return { fd, dev: info.dev, ino: info.ino, active: true };
  } catch (primary) {
    try {
      original.closeSync(fd);
    } catch {
      /* Preserve the original identity-acquisition error after attempting the single owned close. */
    }
    throw primary;
  }
}

/** @param {typeof import("node:fs")} original @param {string} directory @param {boolean} shim */
function pinFixturePaths(original, directory, shim) {
  const before = original.lstatSync(directory, { bigint: true });
  /** @type {PinFixtureDescriptor|undefined} */ let parent;
  const flags =
    original.constants.O_RDONLY |
    original.constants.O_NOFOLLOW |
    original.constants.O_DIRECTORY;
  /** @param {import("node:fs").BigIntStats} info */
  const same = (info) =>
    info.isDirectory() &&
    ["dev", "ino", "uid", "gid", "mode"].every(
      (key) => Reflect.get(info, key) === Reflect.get(before, key),
    );
  const privateDirectory = () => {
    try {
      return (
        process.getuid !== undefined &&
        before.uid === BigInt(process.getuid()) &&
        (before.mode & 0o777n) === 0o700n &&
        original.realpathSync(directory) === directory &&
        same(original.lstatSync(directory, { bigint: true }))
      );
    } catch {
      return false;
    }
  };
  const liveParent = () => {
    try {
      return (
        parent !== undefined &&
        parent.active &&
        privateDirectory() &&
        same(original.fstatSync(parent.fd, { bigint: true }))
      );
    } catch {
      return false;
    }
  };
  /** @param {import("node:fs").PathLike} path */
  const canonical = (path) => {
    if (!liveParent()) return undefined;
    if (path === directory + "/phase.json.new") return "temporary";
    if (typeof path !== "string") return undefined;
    const match =
      /^\/(?:proc\/self\/fd|dev\/fd)\/(0|[1-9][0-9]*)\/phase\.json\.new$/u.exec(
        path,
      );
    return match !== null && match[1] === String(parent?.fd)
      ? "temporary"
      : undefined;
  };
  return {
    /** @param {import("node:fs").PathLike} path @param {number|string} requested */
    classify(path, requested) {
      if (path === directory && requested === flags && privateDirectory())
        return "parent";
      return canonical(path);
    },
    /** @param {PinFixtureDescriptor} entry */
    parent(entry) {
      if (
        !privateDirectory() ||
        !same(original.fstatSync(entry.fd, { bigint: true }))
      )
        throw new Error("fixture parent identity mismatch");
      parent = entry;
    },
    /** @param {import("node:fs").PathLike} path */
    io(path) {
      if (!shim || typeof path !== "string" || !liveParent()) return path;
      const match =
        /^\/(?:proc\/self\/fd|dev\/fd)\/(0|[1-9][0-9]*)(|\/|\/phase\.json|\/phase\.json\.new)$/u.exec(
          path,
        );
      if (match === null || match[1] !== String(parent?.fd)) return path;
      return directory + match[2];
    },
  };
}

// deterministic-test-allow unit-io: raw FD-address bookkeeping uses real owned identities before any Mac-only translation; no OS anchoring is claimed.
/** @typedef {PinFixtureDescriptor & {path:string}} AliasDirectory */
/** @typedef {{handles:PinFixtureDescriptor[], rescue:PinFixtureDescriptor[], directories:AliasDirectory[], root?:AliasDirectory, rootHandle?:PinFixtureDescriptor|undefined, rescueRoot?:PinFixtureDescriptor, expected?:unknown, failedFd?:number, failedHandle?:PinFixtureDescriptor, closed?:boolean}} AliasAudit */
/** @param {typeof import("node:fs")} original @param {AliasDirectory} entry */
function aliasDirectoryMatches(original, entry) {
  try {
    const info = original.lstatSync(entry.path, { bigint: true });
    return (
      info.isDirectory() && info.dev === entry.dev && info.ino === entry.ino
    );
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return false;
    throw error;
  }
}
/** @param {typeof import("node:fs")} original @param {AliasAudit} audit @param {boolean} primary */
function finishRawAliasFixture(original, audit, primary) {
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
  /** @param {PinFixtureDescriptor} entry */
  const close = (entry) => {
    if (!entry.active) return;
    entry.active = false;
    for (const backup of audit.rescue)
      if (
        backup.fd === entry.fd &&
        backup.dev === entry.dev &&
        backup.ino === entry.ino
      )
        backup.active = false;
    let info;
    try {
      info = original.fstatSync(entry.fd, { bigint: true });
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "EBADF")
        return;
      throw error;
    }
    if (info.dev === entry.dev && info.ino === entry.ino)
      original.closeSync(entry.fd);
  };
  for (const entry of audit.handles) attempt(() => close(entry));
  const root = audit.root,
    held = audit.rootHandle;
  const rootOwned = () => {
    if (
      root === undefined ||
      held === undefined ||
      !held.active ||
      !aliasDirectoryMatches(original, root)
    )
      return false;
    const info = original.fstatSync(held.fd, { bigint: true });
    return (
      info.isDirectory() &&
      info.dev === root.dev &&
      info.ino === root.ino &&
      original.realpathSync(root.path) === root.path &&
      (info.mode & 0o777n) === 0o700n &&
      process.getuid !== undefined &&
      info.uid === BigInt(process.getuid())
    );
  };
  for (const entry of [...audit.directories].reverse())
    attempt(() => {
      if (rootOwned() && aliasDirectoryMatches(original, entry))
        original.rmdirSync(entry.path);
    });
  let removeRoot = false;
  attempt(() => {
    removeRoot =
      root !== undefined &&
      aliasDirectoryMatches(original, root) &&
      original.realpathSync(root.path) === root.path &&
      (() => {
        const info = original.lstatSync(root.path, { bigint: true });
        return (
          (info.mode & 0o777n) === 0o700n &&
          process.getuid !== undefined &&
          info.uid === BigInt(process.getuid())
        );
      })();
  });
  if (held !== undefined) attempt(() => close(held));
  audit.closed = [
    ...audit.handles,
    ...(held === undefined ? [] : [held]),
  ].every((entry) => {
    try {
      original.fstatSync(entry.fd);
      return false;
    } catch (error) {
      return (
        error instanceof Error && "code" in error && error.code === "EBADF"
      );
    }
  });
  if (removeRoot && root !== undefined)
    attempt(() => {
      if (aliasDirectoryMatches(original, root)) original.rmdirSync(root.path);
    });
  if (failed && !primary) throw first;
}
/** @param {typeof import("node:fs")} original @param {AliasAudit} audit @param {string} directory @param {()=>void} verdict @param {string} failure */
function replaceRawAliasParent(original, audit, directory, verdict, failure) {
  const info = original.lstatSync(directory, { bigint: true });
  const moved = directory + "-moved";
  const identity = {
    path: moved,
    fd: -1,
    dev: info.dev,
    ino: info.ino,
    active: false,
  };
  audit.directories.push(identity);
  const ownedRoot = () => {
    const root = audit.root,
      held = audit.rootHandle;
    if (
      root === undefined ||
      held === undefined ||
      !held.active ||
      !aliasDirectoryMatches(original, root)
    )
      return false;
    const current = original.fstatSync(held.fd, { bigint: true });
    return (
      current.isDirectory() &&
      current.dev === root.dev &&
      current.ino === root.ino &&
      original.realpathSync(root.path) === root.path &&
      (current.mode & 0o777n) === 0o700n &&
      process.getuid !== undefined &&
      current.uid === BigInt(process.getuid())
    );
  };
  if (!ownedRoot()) throw new Error("fixture root identity mismatch");
  try {
    original.lstatSync(moved);
    throw new Error("fixture move destination already exists");
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
  }
  original.renameSync(directory, moved);
  /** @type {AliasDirectory|undefined} */ let replacement;
  let primary = false;
  const cleanup = () => {
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
    attempt(() => {
      if (
        replacement !== undefined &&
        ownedRoot() &&
        aliasDirectoryMatches(original, replacement)
      ) {
        if (failure === "remove") throw new Error("controlled removal refusal");
        original.rmdirSync(directory);
      }
    });
    attempt(() => {
      if (!ownedRoot() || !aliasDirectoryMatches(original, identity)) return;
      try {
        original.lstatSync(directory);
        return;
      } catch (error) {
        if (!(
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        ))
          throw error;
      }
      original.renameSync(moved, directory);
    });
    if (failed && !primary) throw first;
  };
  try {
    if (failure === "mkdir") {
      const error = new Error("controlled mkdir refusal");
      audit.expected = error;
      throw error;
    }
    original.mkdirSync(directory, { mode: 0o700 });
    const created = original.lstatSync(directory, { bigint: true });
    replacement = {
      path: directory,
      fd: -1,
      dev: created.dev,
      ino: created.ino,
      active: false,
    };
    audit.directories.push(replacement);
    if (failure === "remove") {
      try {
        assert.fail("controlled replacement verdict");
      } catch (error) {
        audit.expected = error;
        throw error;
      }
    }
    verdict();
  } catch (error) {
    primary = true;
    throw error;
  } finally {
    cleanup();
  }
}

/** @param {string} failure @param {AliasAudit} audit */
async function runRawAliasFixture(failure, audit) {
  const fs = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const original = { ...fs.default };
  let primaryActive = false;
  try {
    const root = original.mkdtempSync(
      join(original.realpathSync(tmpdir()), "inside-sdk-raw-anchor-"),
    );
    const rootInfo = original.lstatSync(root, { bigint: true });
    audit.root = {
      path: root,
      fd: -1,
      dev: rootInfo.dev,
      ino: rootInfo.ino,
      active: false,
    };
    if (failure === "root_open") {
      const error = Object.assign(new Error("controlled root open refusal"), {
        code: "EMFILE",
      });
      audit.expected = error;
      throw error;
    }
    const rootOps =
      failure === "root_identity"
        ? {
            ...original,
            fstatSync(/** @type {number} */ fd) {
              audit.failedFd = fd;
              const actual = original.fstatSync(fd, { bigint: true });
              audit.failedHandle = {
                fd,
                dev: actual.dev,
                ino: actual.ino,
                active: true,
              };
              const error = new Error("controlled root identity refusal");
              audit.expected = error;
              throw error;
            },
          }
        : original;
    audit.rootHandle = openPinFixtureDescriptor(
      rootOps,
      root,
      original.constants.O_RDONLY |
        original.constants.O_NOFOLLOW |
        original.constants.O_DIRECTORY,
    );
    if (failure !== "none") {
      if (failure === "backup_open") {
        const error = Object.assign(
          new Error("controlled backup open refusal"),
          { code: "EMFILE" },
        );
        audit.expected = error;
        throw error;
      }
      audit.rescueRoot = openPinFixtureDescriptor(
        original,
        root,
        original.constants.O_RDONLY |
          original.constants.O_NOFOLLOW |
          original.constants.O_DIRECTORY,
      );
    }
    const directory = root + "/parent",
      handles = audit.handles;
    original.mkdirSync(directory, { mode: 0o700 });
    const parentInfo = original.lstatSync(directory, { bigint: true });
    audit.directories.push({
      path: directory,
      fd: -1,
      dev: parentInfo.dev,
      ino: parentInfo.ino,
      active: false,
    });
    const paths = pinFixturePaths(original, directory, false);
    const flags =
      original.constants.O_RDONLY |
      original.constants.O_NOFOLLOW |
      original.constants.O_DIRECTORY;
    const entry = openPinFixtureDescriptor(original, directory, flags),
      fd = entry.fd;
    const safetyEntry = { ...entry },
      rescueEntry = { ...entry };
    handles.push(safetyEntry);
    audit.rescue.push(rescueEntry);
    assert.equal(paths.classify(directory, flags), "parent");
    paths.parent(entry);
    const io = paths.io;
    let translations = 0;
    paths.io = (path) => {
      translations++;
      return io(path);
    };
    const otherEntry = openPinFixtureDescriptor(original, directory, flags),
      fd2 = otherEntry.fd;
    const otherSafety = { ...otherEntry },
      otherRescue = { ...otherEntry };
    handles.push(otherSafety);
    audit.rescue.push(otherRescue);
    for (const prefix of ["/proc/self/fd/", "/dev/fd/"]) {
      const raw = prefix + fd + "/phase.json.new";
      assert.equal(
        paths.classify(raw, original.constants.O_WRONLY),
        "temporary",
      );
      assert.equal(
        paths.classify(raw, original.constants.O_RDONLY),
        "temporary",
      );
      assert.equal(io(raw), raw, "real I/O address was rewritten");
      for (const invalid of [
        prefix + fd2 + "/phase.json.new",
        prefix + "2147483647/phase.json.new",
        prefix + "0" + fd + "/phase.json.new",
        prefix + fd + "/other.json.new",
        prefix + fd + "/phase.json.new/extra",
        prefix + fd + "/../phase.json.new",
        prefix + fd + "/phase.json.new?x",
        prefix + fd + "/phase.json.new\n",
        "/proc/1/fd/" + fd + "/phase.json.new",
        directory + "/foreign-module.mjs",
      ]) {
        assert.equal(
          paths.classify(invalid, original.constants.O_RDONLY),
          undefined,
        );
        assert.equal(io(invalid), invalid);
      }
    }
    assert.equal(translations, 0, "classification invoked the path translator");
    const shim = pinFixturePaths(original, directory, true);
    shim.parent(entry);
    assert.equal(
      shim.io("/proc/self/fd/" + fd + "/phase.json.new"),
      directory + "/phase.json.new",
    );
    assert.equal(
      shim.io("/dev/fd/" + fd2 + "/phase.json.new"),
      "/dev/fd/" + fd2 + "/phase.json.new",
    );
    original.chmodSync(directory, 0o755);
    try {
      assert.equal(
        paths.classify("/proc/self/fd/" + fd + "/phase.json.new", flags),
        undefined,
      );
    } finally {
      original.chmodSync(directory, 0o700);
    }
    replaceRawAliasParent(
      original,
      audit,
      directory,
      () => {
        assert.equal(
          paths.classify("/proc/self/fd/" + fd + "/phase.json.new", flags),
          undefined,
        );
      },
      failure,
    );
    entry.active = false;
    if (failure === "retired") {
      try {
        assert.fail("controlled retired verdict");
      } catch (error) {
        audit.expected = error;
        throw error;
      }
    }
    assert.equal(
      paths.classify("/proc/self/fd/" + fd + "/phase.json.new", flags),
      undefined,
    );
    safetyEntry.active = false;
    rescueEntry.active = false;
    original.closeSync(fd);
    // A separate actual acquisition tests stale live bookkeeping without reviving a retired entry.
    const stale = pinFixturePaths(original, directory, false);
    const other = handles.find((record) => record.fd === fd2);
    assert.ok(other !== undefined);
    stale.parent({ ...other });
    otherSafety.active = false;
    otherRescue.active = false;
    original.closeSync(fd2);
    assert.equal(
      stale.classify("/proc/self/fd/" + fd2 + "/phase.json.new", flags),
      undefined,
    );
  } catch (error) {
    primaryActive = true;
    throw error;
  } finally {
    finishRawAliasFixture(original, audit, primaryActive);
  }
}

// deterministic-test-allow unit-io: raw FD-address bookkeeping uses real owned identities before Mac translation; no OS anchoring is claimed.
test("SDK fixture admits raw owned anchor addresses before translation and excludes unknown paths", async () => {
  await runRawAliasFixture("none", {
    handles: [],
    rescue: [],
    directories: [],
  });
});

// deterministic-test-allow unit-io: failed fixture verdicts and directory mutations retain primary errors and close only recorded owned acquisitions.
test("SDK raw alias fixture contains failed verdicts and parent replacement cleanup", async () => {
  const fs = await import("node:fs"),
    original = { ...fs.default };
  for (const failure of [
    "root_open",
    "backup_open",
    "root_identity",
    "retired",
    "mkdir",
    "remove",
  ]) {
    /** @type {AliasAudit} */ const audit = {
      handles: [],
      rescue: [],
      directories: [],
    };
    let primary = false;
    try {
      await assert.rejects(
        runRawAliasFixture(failure, audit),
        (error) => error === audit.expected,
      );
      assert.equal(
        audit.closed,
        true,
        "fixture left an owned acquisition live",
      );
      const failedHandle = audit.failedHandle;
      if (failedHandle !== undefined) {
        assert.throws(
          () => original.fstatSync(failedHandle.fd),
          (error) =>
            error instanceof Error && "code" in error && error.code === "EBADF",
        );
        failedHandle.active = false;
      }
      assert.ok(audit.root !== undefined);
      assert.equal(
        original.existsSync(audit.root.path),
        false,
        "fixture left an owned directory behind",
      );
    } catch (error) {
      primary = true;
      throw error;
    } finally {
      // Independent post-verdict rescue contains a broken fixture during the RED control.
      finishRawAliasFixture(
        original,
        {
          ...audit,
          handles: [
            ...audit.rescue,
            ...(audit.failedHandle === undefined ? [] : [audit.failedHandle]),
          ],
          rootHandle: audit.rescueRoot?.active
            ? audit.rescueRoot
            : audit.rootHandle?.active
              ? audit.rootHandle
              : undefined,
        },
        primary,
      );
    }
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
  /** @type {PinFixtureDescriptor[]} */ const acquired = [];
  /** @type {Map<number,PinFixtureDescriptor>} */ const active = new Map();
  let primaryActive = false;
  const patches = [];
  let live = false;
  try {
    const paths = pinFixturePaths(
      original,
      directory,
      process.platform !== "linux",
    );
    const translated = paths.io;
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
          const kind = paths.classify(path, flags);
          if (kind === undefined)
            return original.openSync(translated(path), flags, mode);
          const entry = openPinFixtureDescriptor(
            original,
            translated(path),
            flags,
            mode,
          );
          acquired.push(entry);
          active.set(entry.fd, entry);
          if (kind === "parent") paths.parent(entry);
          return entry.fd;
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
          if (paths.classify(from, original.constants.O_RDONLY) !== "temporary")
            return original.renameSync(from, _to);
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
  try {
    const paths = pinFixturePaths(
      original,
      directory,
      process.platform !== "linux",
    );
    const translated = paths.io;
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
          const address = paths.classify(path, flags);
          if (address === undefined)
            return original.openSync(translated(path), flags, mode);
          const kind =
            address === "parent"
              ? "parent"
              : typeof flags === "number" &&
                  (flags & original.constants.O_WRONLY) !== 0
                ? "writer"
                : "pin";
          if (kind === "pin" && fault === "pin_open")
            throw new Error("controlled pin open refusal");
          const acquired = openPinFixtureDescriptor(
              original,
              translated(path),
              flags,
              mode,
            ),
            fd = acquired.fd,
            entry = { ...acquired, attempts: 0, kind };
          active.set(fd, entry);
          handles.push(entry);
          if (kind === "parent") paths.parent(entry);
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
          foreign.push(
            openPinFixtureDescriptor(
              original,
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
          if (
            fault === "combined" &&
            paths.classify(from, original.constants.O_RDONLY) === "temporary"
          )
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
          if (
            fault === "combined" &&
            paths.classify(path, original.constants.O_RDONLY) === "temporary"
          )
            throw new Error("controlled unlink refusal");
          original.unlinkSync(translated(path));
        },
      ),
    );
    syncBuiltinESMExports();
    // An unrelated owned path must pass through without ledger admission or synthetic faults.
    const unrelated = directory + "/foreign-module.mjs";
    const unrelatedFd = fs.default.openSync(
      unrelated,
      original.constants.O_WRONLY |
        original.constants.O_CREAT |
        original.constants.O_EXCL,
      0o600,
    );
    fs.default.closeSync(unrelatedFd);
    fs.default.renameSync(unrelated, unrelated + ".moved");
    fs.default.unlinkSync(unrelated + ".moved");
    assert.equal(
      handles.length,
      0,
      "fixture adopted an unrelated file operation",
    );
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
  const fs = await import("node:fs");
  const original = { ...fs.default };
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
    finishPinFixture(
      original,
      [],
      () => {},
      undefined,
      audit.leaked === undefined ? [] : [audit.leaked],
      [],
      primaryActive,
    );
  }
});
