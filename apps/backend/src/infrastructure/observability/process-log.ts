import { randomUUID } from "node:crypto";

import type { TechnicalTelemetry } from "./technical-telemetry.js";
import type { BackendProcess } from "../../config/platform-config.js";
import type { PgBossWorkObserver } from "../pg-boss-work-observation.js";
import { dependencyFailure } from "./dependency-failure.js";
import { describeError, runWithLogContext, writeLog } from "./log.js";

// Уборка после отказа запуска обычно успевает; дольше процесс не держит открытое соединение.
const FAILED_PROCESS_EXIT_GRACE_MILLISECONDS = 5_000;

/**
 * Процесс, который не смог запуститься или остановился с ошибкой, называет её и завершается
 * с кодом 1. Выход без открытых соединений наступает сразу; оставшееся соединение не держит
 * процесс дольше отсрочки.
 */
export function reportProcessFailure(
  processName: BackendProcess,
  error: unknown,
): void {
  writeLog("error", "process_failed", {
    process: processName,
    status: "operator_attention",
    error: describeError(error),
  });
  process.exitCode = 1;
  setTimeout(
    () => process.exit(1),
    FAILED_PROCESS_EXIT_GRACE_MILLISECONDS,
  ).unref();
}

/** Очередь заданий потеряла базу или свою схему; воркер продолжает и повторяет сам. */
export function reportQueueFailure(
  processName: BackendProcess,
  error: unknown,
): void {
  writeLog("error", "queue_unavailable", {
    process: processName,
    status: "operator_attention",
    error: describeError(error),
  });
}

/**
 * Обработчик задания очереди с контекстом журнала: каждый запуск получает свой `requestId`.
 * Отказ задания записывается с причиной и уходит дальше, чтобы очередь учла его как прежде.
 */
export function observeJob<
  Jobs extends readonly { readonly id: string }[],
  Result,
>(
  processName: BackendProcess,
  queue: string,
  handler: (jobs: Jobs) => Promise<Result>,
  telemetry?: Pick<TechnicalTelemetry, "runJob">,
  work?: PgBossWorkObserver,
): (jobs: Jobs) => Promise<Result> {
  const observed = (jobs: Jobs) =>
    runWithLogContext(
      { process: processName, queue, requestId: jobs[0]?.id ?? randomUUID() },
      async () => {
        try {
          const result = await handler(jobs);
          try {
            await work?.completed(queue, jobs);
          } catch (error) {
            // Observation loss must not retry an already successful business handler.
            dependencyFailure(
              { module: "PgBossWorkObservation", operation: "completed" },
              error,
              undefined,
            );
          }
          return result;
        } catch (error) {
          writeLog("error", "job_failed", { error: describeError(error) });
          throw error;
        }
      },
    );
  return (jobs) =>
    telemetry === undefined
      ? observed(jobs)
      : telemetry.runJob(() => observed(jobs));
}
