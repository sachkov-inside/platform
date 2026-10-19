import type { ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  spawnOwned,
  stopOwned,
} from "../../../../../scripts/owned-process.mjs";

const PROCESS_FACT_BUDGET_MS = 25_000;
const PROCESS_CLEANUP_BUDGET_MS = 10_000;

export async function boundedProcessFact<Value>(
  fact: Promise<Value>,
  budgetMs = PROCESS_FACT_BUDGET_MS,
): Promise<Value> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const deadline = new Promise<never>((_, reject) => {
      // deterministic-test-allow duration-wait: bound a real process/message fact; timer is cleared in finally.
      timer = setTimeout(
        () => reject(new Error("queue fixture process deadline")),
        budgetMs,
      );
    });
    return await Promise.race([fact, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

export interface QueueTelemetryProcess {
  readonly child: ChildProcess;
  readonly firstMessage: Promise<unknown>;
  readonly exited: Promise<readonly [number | null, NodeJS.Signals | null]>;
  readonly messages: unknown[];
  readonly output: string[];
  stop(): Promise<void>;
}

/** The independent Python supervisor survives test-worker exit/SIGKILL and reaps the command tree. */
export function launchQueueTelemetryProcess(
  input: {
    readonly databaseUrl: string;
    readonly endpoint: string;
  } & (
    | {
        readonly mode: "produce" | "crash" | "retry" | "ownership";
      }
    | {
        readonly mode: "worker";
        readonly worker:
          | "profile-avatars-worker"
          | "video-deletions-worker"
          | "billing-worker";
        readonly enabled: boolean;
      }
  ),
): QueueTelemetryProcess {
  const child = spawnOwned(
    process.execPath,
    [
      "--import",
      "tsx",
      fileURLToPath(
        new URL(
          input.mode === "worker"
            ? "../fixtures/technical-worker.ts"
            : "../fixtures/pg-boss-telemetry-worker.ts",
          import.meta.url,
        ),
      ),
    ],
    {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...(input.mode === "worker"
          ? {
              PATH: process.env["PATH"],
              NODE_ENV: "test",
              DATABASE_URL: input.databaseUrl,
              KINESCOPE_PROVIDER_MODE: "test",
              ...(input.enabled ? { INSIDE_OTEL_ENABLED: "true" } : {}),
              INSIDE_OTEL_ENDPOINT: input.endpoint,
            }
          : Object.fromEntries(
              Object.entries(process.env).filter(
                ([key]) => !key.startsWith("OTEL_EXPORTER_OTLP"),
              ),
            )),
        PG_BOSS_TELEMETRY_FIXTURE: JSON.stringify(input),
      },
    },
  );
  const messages: unknown[] = [];
  const output: string[] = [];
  let message: ((value: unknown) => void) | undefined;
  let rejectMessage: ((error: unknown) => void) | undefined;
  const firstMessage = new Promise<unknown>((resolve, reject) => {
    message = resolve;
    rejectMessage = reject;
  });
  const exited = new Promise<readonly [number | null, NodeJS.Signals | null]>(
    (resolve, reject) => {
      child.once("error", (error) => {
        rejectMessage?.(error);
        reject(error);
      });
      // close includes supervisor reaping and closure of inherited stdout/stderr descriptors.
      child.once("close", (code, signal) => {
        rejectMessage?.(new Error("queue fixture closed before message"));
        resolve([code, signal]);
      });
    },
  );
  let buffered = "";
  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    buffered += chunk;
    for (;;) {
      const end = buffered.indexOf("\n");
      if (end < 0) break;
      const line = buffered.slice(0, end);
      buffered = buffered.slice(end + 1);
      try {
        const record = z
          .record(z.string(), z.unknown())
          .parse(JSON.parse(line));
        if (typeof record["kind"] === "string") {
          messages.push(record);
          message?.(record);
        } else output.push(`${line}\n`);
      } catch {
        rejectMessage?.(new Error("invalid queue fixture protocol"));
      }
    }
  });
  if (input.mode === "worker") {
    let errors = "";
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      errors += chunk;
      for (;;) {
        const end = errors.indexOf("\n");
        if (end < 0) break;
        output.push(`${errors.slice(0, end)}\n`);
        errors = errors.slice(end + 1);
      }
    });
  } else child.stderr?.resume();
  // Consume early rejection until the caller awaits the bounded fact.
  void firstMessage.catch(() => undefined);
  void exited.catch(() => undefined);
  return {
    child,
    firstMessage,
    exited,
    messages,
    output,
    stop: async () => {
      await boundedProcessFact(stopOwned(child, 0), PROCESS_CLEANUP_BUDGET_MS);
      await boundedProcessFact(exited, PROCESS_CLEANUP_BUDGET_MS);
    },
  };
}

/** Attempt every owned cleanup in dependency order; a failed cleanup must fail the contract. */
export async function finishFixtureCleanup(
  steps: readonly (() => unknown)[],
): Promise<void> {
  const failures: unknown[] = [];
  for (const step of steps) {
    try {
      await step();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0)
    throw new AggregateError(failures, "queue fixture cleanup failed");
}
