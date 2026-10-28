// @ts-check
// deterministic-test-allow unit-io: owned phase inode plus real Python collector; all child/listener-free resources closed in finally.
import assert from "node:assert/strict";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { syncBuiltinESMExports } from "node:module";
import { test, mock } from "node:test";
import { spawnOwned, stopOwned } from "../owned-process.mjs";
import { createSdkEmitterPhase } from "./emitter-phase.mjs";

/** @param {(phase:NonNullable<ReturnType<typeof createSdkEmitterPhase>>,directory:string)=>Promise<void>} run */
async function withPhase(run) {
  const directory = fs.realpathSync(
    fs.mkdtempSync(join(tmpdir(), "inside-sdk-failure-phase-")),
  );
  const originals = {
    statSync: fs.statSync,
    realpathSync: fs.realpathSync,
    lstatSync: fs.lstatSync,
    openSync: fs.openSync,
    renameSync: fs.renameSync,
    unlinkSync: fs.unlinkSync,
  };
  /** @param {import("node:fs").PathLike} path */
  const translate = (path) =>
    typeof path === "string" && /^\/proc\/self\/fd\/[0-9]+(?:\/|$)/u.test(path)
      ? directory + path.replace(/^\/proc\/self\/fd\/[0-9]+/u, "")
      : path;
  const patches = [];
  try {
    // macOS has no /proc. This controlled FD-path seam proves the actual file protocol,
    // not native Linux descriptor anchoring; Linux uses the actual native implementation.
    if (process.platform !== "linux") {
      for (const name of /** @type {const} */ ([
        "statSync",
        "realpathSync",
        "lstatSync",
        "openSync",
        "unlinkSync",
      ]))
        patches.push(
          mock.method(fs, name, (/** @type {unknown[]} */ ...args) => {
            /** @type {unknown} */ const result = Reflect.apply(
              originals[name],
              fs,
              [
                typeof args[0] === "string" ? translate(args[0]) : args[0],
                ...args.slice(1),
              ],
            );
            return result;
          }),
        );
      patches.push(
        mock.method(
          fs,
          "renameSync",
          (
            /** @type {import("node:fs").PathLike} */ from,
            /** @type {import("node:fs").PathLike} */ to,
          ) => originals.renameSync(translate(from), translate(to)),
        ),
      );
      syncBuiltinESMExports();
    }
    const phase = createSdkEmitterPhase({
      INSIDE_SDK_EMITTER_PHASE_PATH: join(directory, "phase.json"),
      INSIDE_SDK_EMITTER_PHASE_SOURCE: "a".repeat(40),
    });
    assert.ok(phase, "owned phase factory must be available");
    await run(phase, directory);
  } finally {
    for (const patch of patches) patch.mock.restore();
    syncBuiltinESMExports();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test(
  "actual JS first failure and maximum writer are accepted by Python collector",
  { timeout: 30000 },
  async () =>
    withPhase(async (phase, directory) => {
      phase.enter("sdk_diagnostics");
      phase.diagnostics({
        droppedSpans: 1000000,
        failedTraceExports: 1000000,
        failedMetricExports: 1000000,
      });
      phase.exportFailure("traces", {
        kind: "network",
        code: "EHOSTUNREACH",
        elapsedMs: 600000,
      });
      phase.exportFailure("metrics", {
        kind: "network",
        code: "ECONNREFUSED",
        elapsedMs: 600000,
      });
      phase.exportFailure("traces", { kind: "http", code: 400, elapsedMs: 0 });
      phase.enter("provider_acquisition");
      phase.failed();
      const raw = fs.readFileSync(join(directory, "phase.json"));
      assert.equal(raw.length, 463);
      assert.ok(raw.length <= 512);
      const value = {
        schema: 1,
        scope: "sdk",
        source: "a".repeat(40),
        state: "failed",
        phase: "provider_acquisition",
        reason: "operation_failed",
        diagnostics: {
          available: true,
          saturated: false,
          droppedSpans: 1000000,
          failedTraceExports: 1000000,
          failedMetricExports: 1000000,
        },
        exportFailures: {
          available: true,
          traces: { kind: "network", code: "EHOSTUNREACH", elapsedMs: 600000 },
          metrics: { kind: "network", code: "ECONNREFUSED", elapsedMs: 600000 },
        },
      };
      assert.deepEqual(JSON.parse(raw.toString()), value);
      const child = spawnOwned(
        "python3",
        [
          "-B",
          "-c",
          "import sys,json;sys.path.insert(0,'scripts/observability-sdk-storage');import emitter_phase as p;from pathlib import Path;d=Path(sys.argv[1]);p.write(d/p.NAME,p.read_child(d/'phase.json',source='a'*40),source='a'*40);print(json.dumps(p.load_for_collection(d,source='a'*40),sort_keys=True,separators=(',',':')))",
          directory,
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      let stdout = "",
        stderr = "";
      child.stdout?.on("data", (b) => {
        stdout += b;
        if (stdout.length > 512) void stopOwned(child, 100);
      });
      child.stderr?.on("data", (b) => {
        stderr += b;
        if (stderr.length > 1024) void stopOwned(child, 100);
      });
      try {
        /** @type {unknown} */ const code = await new Promise((ok, no) => {
          child.once("error", no);
          child.once("close", ok);
        });
        assert.equal(code, 0);
        assert.equal(stderr, "");
        assert.deepEqual(JSON.parse(stdout), value);
      } finally {
        await stopOwned(child, 100);
      }
    }),
);

test(
  "hostile optional failure data is unavailable without invoking getters or replacing phase",
  { timeout: 30000 },
  async () => {
    let touched = 0;
    const values = [
      {
        kind: "unknown",
        get elapsedMs() {
          touched++;
          throw Error("private-sentinel");
        },
      },
      new Proxy(
        {},
        {
          ownKeys() {
            touched++;
            throw Error("private-sentinel");
          },
        },
      ),
      { kind: "timeout", elapsedMs: 1, private: "private-sentinel" },
    ];
    for (const hostile of values)
      await withPhase(async (phase, directory) => {
        phase.enter("sdk_flush");
        phase.exportFailure("metrics", hostile);
        phase.exportFailure("traces", { kind: "timeout", elapsedMs: 1 });
        phase.failed();
        const raw = fs.readFileSync(join(directory, "phase.json"), "utf8");
        assert.deepEqual(JSON.parse(raw), {
          schema: 1,
          scope: "sdk",
          source: "a".repeat(40),
          state: "failed",
          phase: "sdk_flush",
          reason: "operation_failed",
          exportFailures: { available: false },
        });
        assert.equal(touched, 0);
        assert.ok(!raw.includes("private"));
      });
  },
);
