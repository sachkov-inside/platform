import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { z } from "zod";

const backendRoot = fileURLToPath(new URL("../..", import.meta.url));
const logRecord = z.record(z.string(), z.unknown());

describe("worker startup failure", () => {
  it("names the reason in the structured log and exits non-zero", () => {
    const run = spawnSync(process.execPath, ["--import", "tsx", "src/entrypoints/notifications-worker.ts"], {
      cwd: backendRoot,
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://inside:db-secret@127.0.0.1:1/inside",
      },
      timeout: 60_000,
    });

    expect(run.status).toBe(1);
    const lines = `${run.stdout}${run.stderr}`.split("\n").filter((line) => line.trim() !== "");
    const records = lines.map((line) => logRecord.parse(JSON.parse(line)));
    expect(records.find((record) => record.event === "process_failed")).toMatchObject({
      level: "error",
      process: "notifications-worker",
      status: "operator_attention",
      error: { type: "Error", message: "Notifications configuration required" },
    });
    expect(lines.join("\n")).not.toContain("db-secret");
  });
});
