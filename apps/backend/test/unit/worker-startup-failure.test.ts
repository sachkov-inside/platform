import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { reportProcessFailure } from "../../src/infrastructure/observability/index.js";

const backendRoot = fileURLToPath(new URL("../..", import.meta.url));
const logRecord = z.record(z.string(), z.unknown());
/**
 * Запуск воркера отдельным процессом — холодная компиляция входа через tsx и загрузка его модулей.
 * Эта длительность принадлежит машине, а не проверяемому поведению. Измерено: локально 0.9–2.2 с,
 * когда файл идёт один, и 1.3–1.5 с под всем unit-набором; на раннере CI (23 прогона) 2.8–5.1 с у
 * `notifications-worker` и 2.0–3.8 с у `material-assets-worker`. Бюджет — почти двенадцатикратный
 * запас к худшему наблюдённому запуску: он останавливает только воркер, который не завершился.
 */
const workerExitBudgetMs = 60_000;
/**
 * Срок случая обязан превышать бюджет процесса, иначе при зависании побеждает безымянный срок
 * Vitest, а не ожидание, которое знает причину. Сверх бюджета остаётся разбор вывода и проверки.
 */
const workerCaseTimeoutMs = workerExitBudgetMs + 5_000;

describe("worker startup failure", () => {
  it.each([
    {
      worker: "notifications-worker",
      reason: "its configuration is incomplete",
      error: { type: "Error", message: "Notifications configuration required" },
    },
    {
      worker: "material-assets-worker",
      reason: "its database is unreachable",
      error: {
        code: "ECONNREFUSED",
        message: "connect ECONNREFUSED 127.0.0.1:1",
      },
    },
  ])(
    "$worker names why it stopped when $reason and exits with code 1",
    ({ worker, error }) => {
      const run = spawnSync(
        process.execPath,
        ["--import", "tsx", `src/entrypoints/${worker}.ts`],
        {
          cwd: backendRoot,
          encoding: "utf8",
          env: {
            PATH: process.env["PATH"],
            NODE_ENV: "test",
            DATABASE_URL: "postgresql://inside:db-secret@127.0.0.1:1/inside",
          },
          timeout: workerExitBudgetMs,
        },
      );

      // Если бюджет убил процесс, случай падает здесь с `ETIMEDOUT`, а не на `null` вместо кода.
      expect(run.error).toBeUndefined();
      expect(run.status).toBe(1);
      const lines = `${run.stdout}${run.stderr}`
        .split("\n")
        .filter((line) => line.trim() !== "");
      const records = lines.map((line) => logRecord.parse(JSON.parse(line)));
      expect(
        records.find((record) => record["event"] === "process_failed"),
      ).toMatchObject({
        level: "error",
        process: worker,
        status: "operator_attention",
        error,
      });
      expect(lines.join("\n")).not.toContain("db-secret");
    },
    workerCaseTimeoutMs,
  );

  describe("when an open connection outlives the failure", () => {
    afterEach(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
      process.exitCode = undefined;
    });

    it("still exits with code 1 after a short grace period", () => {
      vi.useFakeTimers();
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const exit = vi.spyOn(process, "exit").mockImplementation((code) => {
        throw new Error(`process.exit(${String(code)})`);
      });

      reportProcessFailure(
        "video-deletions-worker",
        new Error("connect ECONNREFUSED 127.0.0.1:5432"),
      );

      expect(process.exitCode).toBe(1);
      expect(exit).not.toHaveBeenCalled();
      expect(() => vi.advanceTimersByTime(5_000)).toThrow("process.exit(1)");
    });
  });
});
