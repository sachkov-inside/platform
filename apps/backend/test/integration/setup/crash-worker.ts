import type { ChildProcess } from "node:child_process";
import { presentText } from "../../../src/infrastructure/contracts/text.js";
import type { CrashWorkerSignal } from "./crash-worker-protocol.js";

/** Observe a crash worker forked in its own process group, including inherited compiler pipes. */
export function watchCrashWorker(child: ChildProcess) {
  const reached = new Set<string>();
  let wake: (() => void) | undefined;
  let stderr = "";
  let departure: string | undefined;
  let exit:
    | { readonly code: number | null; readonly signal: NodeJS.Signals | null }
    | undefined;
  child.stderr?.on("data", (chunk) => {
    stderr += String(chunk);
  });
  child.on("message", (message) => {
    if (typeof message !== "string") return;
    reached.add(message);
    wake?.();
  });
  const closed = new Promise<void>((resolve) => {
    child.once("close", (code, signal) => {
      departure = `closed (code ${String(code)}, signal ${String(signal)})`;
      exit = { code, signal };
      wake?.();
      resolve();
    });
  });
  const detail = () => presentText(stderr.trim()) ?? "no stderr output";
  return {
    /**
     * Смерть на барьере — шаг сценария. Ждём её по `close`, который приходит ровно один раз:
     * `once(child, 'exit')` после уже случившегося выхода ждал бы вечно, и безымянный срок теста
     * скрыл бы, что воркер ушёл сам. Возвращает, как именно процесс закончился.
     */
    async kill(): Promise<{
      readonly signal: NodeJS.Signals | null;
      readonly description: string;
    }> {
      if (departure === undefined && child.pid !== undefined) {
        // tsx's compiler inherits stderr. Killing only Node leaves close waiting on that pipe.
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch (error) {
          if (!(
            error instanceof Error &&
            "code" in error &&
            error.code === "ESRCH"
          ))
            throw error;
        }
      }
      await closed;
      return {
        signal: exit?.signal ?? null,
        description: `${String(departure)}: ${detail()}`,
      };
    },
    async reaches(awaited: CrashWorkerSignal, budgetMs: number): Promise<void> {
      await new Promise<void>((resolve, reject) => {
        const settle = () => {
          clearTimeout(timer);
          wake = undefined;
          if (reached.has(awaited)) resolve();
          else if (departure !== undefined)
            reject(
              new Error(
                `Crash worker ${departure} before ${awaited}: ${detail()}`,
              ),
            );
          else
            reject(
              new Error(
                `Crash worker is alive but did not reach ${awaited} within ${String(budgetMs)}ms: ${detail()}`,
              ),
            );
        };
        // deterministic-test-allow duration-wait: Deadline bounds a signal barrier; receipt or close settles it first.
        const timer = setTimeout(settle, budgetMs);
        wake = settle;
        if (reached.has(awaited) || departure !== undefined) settle();
      });
    },
  };
}
