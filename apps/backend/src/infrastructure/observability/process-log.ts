import { randomUUID } from "node:crypto";

import type { BackendProcess } from "../../config/platform-config.js";
import { describeError, runWithLogContext, writeLog } from "./log.js";

/**
 * Процесс, который не смог запуститься или остановился с ошибкой, называет её и завершается
 * с ненулевым кодом. Уборка уже сделана запуском, поэтому выход не прерывает её принудительно.
 */
export function reportProcessFailure(process: BackendProcess, error: unknown): void {
  writeLog("error", "process_failed", { process, status: "operator_attention", error: describeError(error) });
  globalThis.process.exitCode = 1;
}

/** Очередь заданий потеряла базу или свою схему; воркер продолжает и повторяет сам. */
export function reportQueueFailure(process: BackendProcess, error: unknown): void {
  writeLog("error", "queue_unavailable", { process, status: "operator_attention", error: describeError(error) });
}

/**
 * Обработчик задания очереди с контекстом журнала: каждый запуск получает свой `requestId`.
 * Отказ задания записывается с причиной и уходит дальше, чтобы очередь учла его как прежде.
 */
export function observeJob<Jobs extends readonly { readonly id: string }[], Result>(
  process: BackendProcess,
  queue: string,
  handler: (jobs: Jobs) => Promise<Result>,
): (jobs: Jobs) => Promise<Result> {
  return (jobs) =>
    runWithLogContext({ process, queue, requestId: jobs[0]?.id ?? randomUUID() }, async () => {
      try {
        return await handler(jobs);
      } catch (error) {
        writeLog("error", "job_failed", { error: describeError(error) });
        throw error;
      }
    });
}
