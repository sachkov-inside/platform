import type { SpawnOptions } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, it, onTestFinished } from "vitest";
import { z } from "zod";

import { spawnOwned, stopOwned } from "../../../../scripts/owned-process.mjs";
import { commandExit } from "../../../../scripts/diagnostic-command.mjs";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const schema = z.object({
  sourceSha: z.hash("sha1"),
  workflowSha: z.hash("sha1"),
  deployedSha: z.hash("sha1"),
  verdict: z.enum(["green", "red"]),
  counts: z.object({
    total: z.number(),
    passed: z.number(),
    failed: z.number(),
    deferred: z.number(),
    not_checked: z.number(),
    skipped_excluded: z.number(),
  }),
  cells: z.array(
    z.object({
      status: z.string(),
      deferralEvaluation: z.object({ status: z.string() }).optional(),
    }),
  ),
});

/** All real commands share the existing tree supervisor, failure budget and cleanup. */
async function runCommand(
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) {
  const child = spawnOwned(command, args, options);
  onTestFinished(() => stopOwned(child));
  const closed = new Promise<void>((resolve) => {
    child.once("close", () => {
      resolve();
    });
  });
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  // deterministic-test-allow duration-wait: Failure budget stops a stuck supervised command tree; command exit observes completion.
  const deadline = setTimeout(() => {
    void stopOwned(child, 0);
  }, 20_000);
  try {
    const status = await commandExit(child);
    await closed;
    return { status, stdout, stderr };
  } finally {
    clearTimeout(deadline);
    await stopOwned(child);
  }
}

it.each([
  ["valid", "green", "valid", "root"],
  ["valid", "green", "valid", "web"],
  ["valid", "green", "valid", "outside"],
  ["valid", "green", "valid", "other-repo"],
  ["ready", "red", "ready", "root"],
  ["free-practice-ready", "red", "ready", "root"],
  ["expired", "red", "expired", "root"],
  ["incomplete", "red", "invalid", "root"],
  ["missing", "red", "unknown", "root"],
  ["empty", "red", undefined, "root"],
  ["no-observations", "red", "valid", "root"],
] as const)(
  "reports %s fixture evidence (%s, %s) from %s through the real CLI exit and artifacts",
  async (scenario, verdict, deferralStatus, workingDirectory) => {
    const directory = mkdtempSync(join(tmpdir(), "inside-pass-cli-"));
    try {
      if (workingDirectory === "other-repo") {
        const initialized = await runCommand(
          "git",
          ["init", "--quiet", directory],
          { cwd: root },
        );
        expect(initialized.status, initialized.stderr).toBe(0);
        const committed = await runCommand(
          "git",
          [
            "-c",
            "user.name=Fixture",
            "-c",
            "user.email=fixture@example.test",
            "commit",
            "--quiet",
            "--allow-empty",
            "-m",
            "Unrelated checkout",
          ],
          {
            cwd: directory,
            env: {
              ...process.env,
              GIT_AUTHOR_DATE: "2026-10-30T12:00:00Z",
              GIT_COMMITTER_DATE: "2026-10-30T12:00:00Z",
            },
          },
        );
        expect(committed.status, committed.stderr).toBe(0);
      }
      if (scenario !== "no-observations")
        mkdirSync(join(directory, "observations"));
      if (scenario !== "empty" && scenario !== "no-observations")
        writeFileSync(
          join(directory, "observations", "live.json"),
          JSON.stringify({
            cellId: "learner-product-a/read-product-a/body@browser",
            observed: "allowed",
          }),
        );
      const { status, stderr } = await runCommand(
        process.execPath,
        [
          join(root, "apps/backend/node_modules/tsx/dist/cli.mjs"),
          join(root, "apps/web/test/fixtures/production-pass/report-cli.ts"),
          scenario,
        ],
        {
          cwd:
            workingDirectory === "outside" || workingDirectory === "other-repo"
              ? directory
              : workingDirectory === "web"
                ? join(root, "apps/web")
                : root,
          env: {
            ...process.env,
            PRODUCTION_ACCESS_REPORT_DIR: directory,
            PRODUCTION_ACCESS_DEPLOYED_SHA: "c".repeat(40),
            GITHUB_SHA: "d".repeat(40),
            PRODUCTION_PASS_FIXTURE_DESCENDANT: "true",
          },
        },
      );
      const descendant = z.coerce
        .number()
        .int()
        .positive()
        .parse(readFileSync(join(directory, "descendant.pid"), "utf8"));
      expect(() => process.kill(descendant, 0)).toThrow(/ESRCH/u);
      expect(status, stderr).toBe(verdict === "green" ? 0 : 1);
      const report = schema.parse(
        JSON.parse(readFileSync(join(directory, "report.json"), "utf8")),
      );
      expect(report.verdict).toBe(verdict);
      const checkout = await runCommand(
        "git",
        ["show", "--format=%H", "--no-patch", "HEAD"],
        { cwd: root },
      );
      expect(checkout.status, checkout.stderr).toBe(0);
      expect(report.sourceSha).toBe(checkout.stdout.trim());
      expect(report.sourceSha).not.toBe(report.deployedSha);
      expect(report.workflowSha).not.toBe(report.sourceSha);
      expect(report.counts).toEqual(
        scenario === "empty"
          ? {
              total: 0,
              passed: 0,
              failed: 0,
              deferred: 0,
              not_checked: 0,
              skipped_excluded: 0,
            }
          : scenario === "no-observations"
            ? {
                total: 2,
                passed: 0,
                failed: 0,
                deferred: 1,
                not_checked: 1,
                skipped_excluded: 0,
              }
            : {
                total: 2,
                passed: 1,
                failed: deferralStatus === "valid" ? 0 : 1,
                deferred: deferralStatus === "valid" ? 1 : 0,
                not_checked: 0,
                skipped_excluded: 0,
              },
      );
      expect(report.cells[1]?.deferralEvaluation?.status).toBe(deferralStatus);
      const markdown = readFileSync(join(directory, "report.md"), "utf8");
      expect(markdown).toContain("skipped/excluded=0");
      expect(markdown).toContain(
        `deferred=${deferralStatus === "valid" ? "1" : "0"}`,
      );
      expect(markdown).toContain(
        `Source SHA (checked-out runner): \`${report.sourceSha}\``,
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
