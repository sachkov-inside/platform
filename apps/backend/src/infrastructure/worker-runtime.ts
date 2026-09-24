import { rm, writeFile } from "node:fs/promises";

import { Pool, type PoolClient } from "pg";
import { z } from "zod";

import type {
  OperationalReadiness,
  ReadinessReport,
  RuntimeProcess,
} from "./operational-readiness.js";
import { listenForProcessShutdown } from "./process-shutdown.js";

export const WORKER_READINESS_PATH = "/tmp/inside-platform-worker-ready.json";
const WORKER_LEASE_CONNECTION_TIMEOUT_MILLISECONDS = 5_000;
const WORKER_GRACEFUL_SHUTDOWN_TIMEOUT_MILLISECONDS = 10_000;

type WorkerProcess = Exclude<RuntimeProcess, "api" | "mcp">;

interface WorkerGenerationLease {
  release(): Promise<void>;
}

const leaseResultSchema = z.array(
  z.object({ acquired: z.boolean() }).strict(),
).length(1);

export async function acquireWorkerGenerationLease(
  databaseUrl: string,
  process: WorkerProcess,
): Promise<WorkerGenerationLease> {
  const pool = new Pool({
    connectionString: databaseUrl,
    connectionTimeoutMillis: WORKER_LEASE_CONNECTION_TIMEOUT_MILLISECONDS,
    max: 1,
  });
  let connection: PoolClient | undefined;
  try {
    connection = await pool.connect();
    const result = leaseResultSchema.parse(
      (
        await connection.query(
          "select pg_try_advisory_lock(hashtextextended($1, 0)) as acquired",
          [`inside-platform-worker:${process}`],
        )
      ).rows,
    );
    if (result[0]?.acquired !== true) {
      throw new Error(
        `Another ${process} generation is still active; stop it before starting this release`,
      );
    }
  } catch (error) {
    connection?.release();
    await pool.end();
    throw error;
  }
  const leasedConnection = connection;

  let released = false;
  return {
    async release() {
      if (released) return;
      released = true;
      try {
        await leasedConnection.query(
          "select pg_advisory_unlock(hashtextextended($1, 0))",
          [`inside-platform-worker:${process}`],
        );
      } finally {
        leasedConnection.release();
        await pool.end();
      }
    },
  };
}

async function markWorkerReady(
  report: ReadinessReport,
): Promise<void> {
  await writeFile(WORKER_READINESS_PATH, `${JSON.stringify(report)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  console.info(JSON.stringify(report));
}

async function markWorkerDraining(
  process: WorkerProcess,
  report: ReadinessReport,
): Promise<void> {
  await removeWorkerReadiness();
  console.info(JSON.stringify({
    process,
    release: report.release,
    schema: report.schema,
    status: "draining",
  }));
}

async function markWorkerStopped(
  process: WorkerProcess,
  report: ReadinessReport | undefined,
): Promise<void> {
  await removeWorkerReadiness();
  console.info(JSON.stringify({
    process,
    ...(report === undefined ? {} : { release: report.release }),
    status: "stopped",
  }));
}

async function removeWorkerReadiness(): Promise<void> {
  await rm(WORKER_READINESS_PATH, { force: true });
}

export async function runWorker(input: {
  readonly application: { close(): Promise<void> };
  readonly databaseUrl: string;
  readonly jobs: { start(): Promise<unknown>; stop(options: { close: boolean; graceful: boolean; timeout: number }): Promise<unknown> };
  readonly failed?: Promise<void>;
  readonly process: WorkerProcess;
  readonly readiness: Pick<OperationalReadiness, "check">;
  readonly registerJobs: () => Promise<void>;
}): Promise<void> {
  const shutdown = listenForProcessShutdown();
  let jobsStarted = false;
  let lease: WorkerGenerationLease | undefined;
  let readinessReport: ReadinessReport | undefined;
  let stopReason: { readonly error: unknown } | undefined;
  try {
    lease = await acquireWorkerGenerationLease(input.databaseUrl, input.process);
    await input.jobs.start();
    jobsStarted = true;
    await input.registerJobs();
    readinessReport = await input.readiness.check(input.process);
    await markWorkerReady(readinessReport);
    await Promise.race([shutdown.received, ...(input.failed ? [input.failed] : [])]);
  } catch (error) {
    stopReason = { error };
  }
  shutdown.dispose();
  // Остановка после отказа — его следствие: её собственные сбои называются отдельно и не
  // подменяют причину, из-за которой воркер остановился.
  const stopFailures: { readonly reason: string; readonly error: unknown }[] = [];
  try {
    if (readinessReport) await markWorkerDraining(input.process, readinessReport);
    else await removeWorkerReadiness();
    if (jobsStarted) {
      await input.jobs.stop({
        close: true,
        graceful: true,
        timeout: WORKER_GRACEFUL_SHUTDOWN_TIMEOUT_MILLISECONDS,
      });
    }
  } catch (error) {
    stopFailures.push({ reason: "worker_drain_failed", error });
  }
  try {
    await input.application.close();
    await lease?.release();
    await markWorkerStopped(input.process, readinessReport);
  } catch (error) {
    stopFailures.push({ reason: "worker_cleanup_failed", error });
  }
  // Наружу уходит одна ошибка: причина остановки, а без неё — первый сбой. Остальные сбои
  // называются здесь. Текст ошибки не пишется: он может нести адрес подключения с учётными данными.
  const thrown = stopReason ?? stopFailures[0];
  for (const failure of stopFailures) {
    if (failure === thrown) continue;
    console.error(JSON.stringify({
      process: input.process,
      reason: failure.reason,
      status: "operator_attention",
    }));
  }
  if (thrown !== undefined) throw thrown.error;
}
