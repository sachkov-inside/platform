import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { cpus, freemem, loadavg, totalmem } from "node:os";
import { format } from "node:util";
import { z } from "zod";

interface Debug {
  enable: (namespaces: string) => void;
  disable: () => string;
  log: (this: { namespace?: string }, ...args: unknown[]) => void;
}

// Playwright's exported bundle owns the same debug instance used by browser/protocol logs.
// Validate the internal seam so an incompatible Playwright upgrade fails visibly.
const require = createRequire(import.meta.url);
const testRequire = createRequire(require.resolve("@playwright/test"));
const playwrightRequire = createRequire(testRequire.resolve("playwright"));
const bundle: unknown = playwrightRequire("playwright-core/lib/utilsBundle");
const debug = z
  .object({
    debug: z.custom<Debug>(
      (value: unknown) =>
        typeof value === "function" &&
        ["enable", "disable", "log"].every(
          (name) => typeof Reflect.get(value, name) === "function",
        ),
    ),
  })
  .parse(bundle).debug;

const logByteLimit = 4 * 1024 * 1024;
const linuxFiles = [
  "/proc/meminfo",
  "/proc/stat",
  "/proc/pressure/cpu",
  "/proc/pressure/memory",
  "/proc/self/cgroup",
  "/sys/fs/cgroup/cpu.stat",
  "/sys/fs/cgroup/memory.current",
  "/sys/fs/cgroup/memory.max",
  "/sys/fs/cgroup/memory.events",
] as const;

export function captureWebkitFailureDiagnostics() {
  const started = performance.now();
  const previousLog = debug.log;
  const previousNamespaces = debug.disable();
  const entries: {
    elapsedMilliseconds: number;
    namespace: string;
    message: string;
  }[] = [];
  const tail: typeof entries = [];
  let bytes = 0;
  let tailBytes = 0;
  let droppedEntries = 0;
  let restored = false;
  debug.log = function (...args) {
    const namespace = this.namespace ?? "";
    if (namespace !== "pw:browser" && namespace !== "pw:protocol") {
      previousLog.apply(this, args);
      return;
    }
    const message = format(...args);
    const size = Buffer.byteLength(message);
    const entry = {
      elapsedMilliseconds: performance.now() - started,
      namespace,
      message,
    };
    if (
      bytes + size <= logByteLimit / 2 &&
      tail.length === 0 &&
      droppedEntries === 0
    ) {
      entries.push(entry);
      bytes += size;
      return;
    }
    if (size > logByteLimit / 2) {
      droppedEntries += 1;
      return;
    }
    tail.push(entry);
    tailBytes += size;
    while (tailBytes > logByteLimit / 2) {
      const removed = tail.shift();
      if (removed !== undefined)
        tailBytes -= Buffer.byteLength(removed.message);
      droppedEntries += 1;
    }
  };
  debug.enable("pw:browser,pw:protocol");

  return {
    elapsedMilliseconds: () => performance.now() - started,
    async snapshot() {
      const linux =
        process.platform === "linux"
          ? await Promise.all(
              linuxFiles.map(async (path) => {
                try {
                  return { path, value: await readFile(path, "utf8") };
                } catch (error) {
                  return {
                    path,
                    error:
                      error instanceof Error ? error.message : String(error),
                  };
                }
              }),
            )
          : [];
      return {
        elapsedMilliseconds: performance.now() - started,
        platform: process.platform,
        runner: {
          cpus: cpus().map(({ times }) => times),
          loadAverage: loadavg(),
          freeMemoryBytes: freemem(),
          totalMemoryBytes: totalmem(),
        },
        worker: {
          cpuUsage: process.cpuUsage(),
          memoryUsage: process.memoryUsage(),
          resourceUsage: process.resourceUsage(),
        },
        linux,
      };
    },
    logs: () => ({
      logByteLimit,
      bytes: bytes + tailBytes,
      droppedEntries,
      head: entries,
      tail,
    }),
    restore() {
      if (restored) return;
      restored = true;
      debug.log = previousLog;
      debug.enable(previousNamespaces);
    },
  };
}
