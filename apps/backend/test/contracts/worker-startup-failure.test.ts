import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { z } from "zod";

const backendRoot = fileURLToPath(new URL("../..", import.meta.url));
const logRecord = z.record(z.string(), z.unknown());
// test:contracts builds before Vitest; cases run compiled entrypoints and observe startup failure.
const workerExitBudgetMs = 60_000;
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
        [`dist/entrypoints/${worker}.js`],
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
});
