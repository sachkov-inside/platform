// @ts-check
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { spawnOwned, stopOwned } from "../owned-process.mjs";

const SUITE = [
  "-B",
  "-m",
  "unittest",
  "discover",
  "-s",
  "scripts/observability-signoz",
  "-p",
  "test_*.py",
];
const OUTPUT_BYTES = 1_048_576;
const SOURCE_CONTRACT_AGGREGATE_TIMEOUT_MS = 60_000;
const OVERRIDE_TIMEOUT_LIMIT_MS = 30_000;

/**
 * One verification entry for tooling and CI. The existing outside owner survives
 * Node owner death and owns detached fixture sessions through native birth identity.
 * args/timeoutMs let the boundary contract substitute only a benign local fixture.
 * @param {{args?: string[], timeoutMs?: number}} [options]
 */
export async function verify(options = {}) {
  const aggregate =
    options.args === undefined && options.timeoutMs === undefined;
  const limitMs = aggregate
    ? SOURCE_CONTRACT_AGGREGATE_TIMEOUT_MS
    : OVERRIDE_TIMEOUT_LIMIT_MS;
  const timeoutMs = options.timeoutMs ?? limitMs;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > limitMs)
    throw new Error("verification budget must not exceed original30 seconds");
  const child = spawnOwned("python3", options.args ?? SUITE, {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
  });
  let stdout = "",
    stderr = "",
    bytes = 0;
  /** @type {"exit" | "timeout" | "interrupted" | "output_limit"} */
  let reason = "exit";
  /** @type {() => void} */
  let abort = () => {};
  const aborted = new Promise((resolve) => {
    abort = () => resolve(undefined);
  });
  const interrupt = () => {
    reason = "interrupted";
    abort();
  };
  const ended = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", () => resolve(undefined));
  });
  const closed = new Promise((resolve) =>
    child.once("close", () => resolve(undefined)),
  );
  const timer = setTimeout(() => {
    reason = "timeout";
    abort();
  }, timeoutMs);
  try {
    if (child.stdout === null || child.stderr === null)
      throw new Error("owned verification pipes required");
    /** @param {unknown} chunk @param {"stdout" | "stderr"} stream */
    const collect = (chunk, stream) => {
      if (typeof chunk !== "string") {
        reason = "output_limit";
        abort();
        return;
      }
      bytes += Buffer.byteLength(chunk);
      if (bytes > OUTPUT_BYTES) {
        reason = "output_limit";
        abort();
        return;
      }
      if (stream === "stdout") stdout += chunk;
      else stderr += chunk;
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => collect(chunk, "stdout"));
    child.stderr.on("data", (chunk) => collect(chunk, "stderr"));
    process.on("SIGTERM", interrupt);
    process.on("SIGINT", interrupt);
    await Promise.race([ended, aborted]);
    await stopOwned(child, 100);
    await closed;
    return {
      code: child.exitCode,
      ownerPid: child.pid,
      reason,
      stdout,
      stderr,
    };
  } finally {
    clearTimeout(timer);
    process.off("SIGTERM", interrupt);
    process.off("SIGINT", interrupt);
    await stopOwned(child, 100);
  }
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const result = await verify();
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exitCode = result.reason === "exit" ? (result.code ?? 1) : 1;
}
