import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { docker } from "./process.mjs";

for (const mode of ["success", "failure", "SIGTERM", "SIGKILL"] as const) {
  void test(
    `resource watchdog removes the owned container after ${mode}`,
    { timeout: 45_000 },
    async (t) => {
      const id = randomUUID();
      const output = resolve(".reports/chapter-one-lifecycle", id);
      await mkdir(output, { recursive: true });
      const report = join(output, "watchdog.json");
      const child = spawn(
        process.execPath,
        [
          fileURLToPath(new URL("fixtures/lease-owner.mjs", import.meta.url)),
          report,
          id,
          mode,
          "inside-chapter-one-agent:0.163.0",
        ],
        { detached: true, stdio: ["pipe", "pipe", "pipe"] },
      );
      t.after(async () => {
        if (child.pid !== undefined) {
          try {
            process.kill(-child.pid, "SIGKILL");
          } catch {
            /* Closed. */
          }
        }
        const remaining = (
          await docker([
            "ps",
            "-aq",
            "--filter",
            `label=inside.chapter-lab=${id}`,
          ])
        ).stdout.trim();
        if (remaining !== "")
          await docker(["rm", "-f", ...remaining.split(/\s+/u)]);
      });
      const closed = new Promise<number | null>((resolveClosed, reject) => {
        child.once("error", reject);
        child.once("close", resolveClosed);
      });
      const ready = new Promise<void>((resolveReady, reject) => {
        let text = "";
        child.stdout.on("data", (chunk: Buffer) => {
          text += chunk.toString();
          if (text.includes("ready\n")) resolveReady();
        });
        child.once("error", reject);
        child.once("exit", () => {
          if (!text.includes("ready\n"))
            reject(Error("Lease fixture exited before readiness"));
        });
      });
      await ready;
      if (mode === "SIGTERM" || mode === "SIGKILL") child.kill(mode);
      const code = await closed;
      assert.equal(
        code,
        mode === "success" ? 0 : mode === "failure" ? 1 : null,
      );
      const raw: unknown = JSON.parse(await readFile(report, "utf8"));
      assert.ok(typeof raw === "object" && raw !== null && "failures" in raw);
      assert.deepEqual(raw.failures, []);
      assert.equal(
        (
          await docker([
            "ps",
            "-aq",
            "--filter",
            `label=inside.chapter-lab=${id}`,
          ])
        ).stdout.trim(),
        "",
      );
    },
  );
}
