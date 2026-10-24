import { fileURLToPath } from "node:url";
import { z } from "zod";
import { spawnOwned, stopOwned } from "../../../../scripts/owned-process.mjs";
import { deferred } from "./deferred.js";

const identitySchema = z.strictObject({
  kind: z.literal("telegram-main-child"),
  pid: z.number().int().min(2),
  node: z.literal("v26.10.0"),
});

/** Closed observations of an owned Node entrypoint. Raw stdout/stderr are never retained. */
export function launchTelegramMain(input: {
  readonly entrypoint: URL;
  readonly environment: Readonly<Record<string, string>>;
  readonly readiness: string;
}) {
  if (process.version !== "v26.10.0")
    throw new Error("Telegram native child requires pinned Node");
  const identity = deferred<z.infer<typeof identitySchema>>();
  const ready = deferred();
  const exited = deferred<readonly [number | null, NodeJS.Signals | null]>();
  let pid: number | undefined;
  let done = false;
  let overflow = false;
  let buffered = "";
  let observedBytes = 0;
  const child = spawnOwned(
    process.execPath,
    [
      "--import",
      fileURLToPath(new URL("./telegram-main-pid.mjs", import.meta.url)),
      fileURLToPath(input.entrypoint),
    ],
    {
      env: { ...input.environment, NODE_DISABLE_COMPILE_CACHE: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  // These deadlines only fail the harness. Application shutdown has no added deadline/cancel.
  // deterministic-test-allow duration-wait: bound owned child identity/readiness facts; clear on exit and each committed fact.
  const identityDeadline = setTimeout(
    () => identity.reject(new Error("Telegram child identity deadline")),
    10_000,
  );
  // deterministic-test-allow duration-wait: bounded readiness fact, never a success delay.
  const readyDeadline = setTimeout(
    () => ready.reject(new Error("Telegram child readiness deadline")),
    10_000,
  );
  void identity.promise.then(
    () => clearTimeout(identityDeadline),
    () => clearTimeout(identityDeadline),
  );
  void ready.promise.then(
    () => clearTimeout(readyDeadline),
    () => clearTimeout(readyDeadline),
  );
  child.stdout?.on("data", (chunk: Buffer) => {
    observedBytes += chunk.length;
    if (observedBytes > 65_536) {
      overflow = true;
      buffered = "";
      identity.reject(
        new Error("Telegram child output exceeded closed budget"),
      );
      ready.reject(new Error("Telegram child output exceeded closed budget"));
      return;
    }
    buffered += chunk.toString("utf8");
    let end: number;
    while ((end = buffered.indexOf("\n")) !== -1) {
      const line = buffered.slice(0, end);
      buffered = buffered.slice(end + 1);
      if (line.startsWith('{"kind":"telegram-main-child"')) {
        try {
          const parsed = identitySchema.safeParse(JSON.parse(line) as unknown);
          if (!parsed.success || pid !== undefined) throw new Error();
          pid = parsed.data.pid;
          identity.resolve(parsed.data);
        } catch {
          identity.reject(new Error("Telegram child identity invalid"));
        }
      } else if (line.includes(input.readiness)) ready.resolve();
    }
  });
  child.stderr?.resume();
  const failure = (): void => {
    identity.reject(new Error("Telegram child exited before identity"));
    ready.reject(new Error("Telegram child exited before readiness"));
    clearTimeout(identityDeadline);
    clearTimeout(readyDeadline);
  };
  child.once("error", () => {
    done = true;
    pid = undefined;
    buffered = "";
    failure();
    exited.resolve([null, null]);
  });
  child.once("exit", (code, signal) => {
    done = true;
    pid = undefined;
    buffered = "";
    failure();
    exited.resolve([code, signal]);
  });
  return {
    identity: identity.promise,
    ready: ready.promise,
    exited: exited.promise,
    hasExited: () => done,
    outputOverflow: () => overflow,
    signal: (): void => {
      if (pid === undefined || done)
        throw new Error("Telegram child is not signalable");
      process.kill(pid, "SIGTERM");
    },
    stop: async (): Promise<void> => {
      try {
        await stopOwned(child);
      } finally {
        clearTimeout(identityDeadline);
        clearTimeout(readyDeadline);
      }
    },
  };
}
