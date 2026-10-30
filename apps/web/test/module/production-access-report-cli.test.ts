import { execFileSync, spawnSync } from "node:child_process";
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

import { expect, it } from "vitest";
import { z } from "zod";

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

it.each([
  ["valid", "green", "valid"],
  ["ready", "red", "ready"],
  ["free-practice-ready", "red", "ready"],
  ["expired", "red", "expired"],
  ["incomplete", "red", "invalid"],
  ["missing", "red", "unknown"],
  ["empty", "red", undefined],
  ["no-observations", "red", "valid"],
] as const)(
  "reports %s fixture evidence through the real CLI exit and artifacts",
  (scenario, verdict, deferralStatus) => {
    const directory = mkdtempSync(join(tmpdir(), "inside-pass-cli-"));
    try {
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
      const result = spawnSync(
        process.execPath,
        [
          join(root, "apps/backend/node_modules/tsx/dist/cli.mjs"),
          join(root, "apps/web/test/fixtures/production-pass/report-cli.ts"),
          scenario,
        ],
        {
          cwd: root,
          encoding: "utf8",
          timeout: 20_000,
          env: {
            ...process.env,
            PRODUCTION_ACCESS_REPORT_DIR: directory,
            PRODUCTION_ACCESS_DEPLOYED_SHA: "c".repeat(40),
            GITHUB_SHA: "d".repeat(40),
          },
        },
      );
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(verdict === "green" ? 0 : 1);
      const report = schema.parse(
        JSON.parse(readFileSync(join(directory, "report.json"), "utf8")),
      );
      expect(report.verdict).toBe(verdict);
      const checkout = execFileSync(
        "git",
        ["show", "--format=%H", "--no-patch", "HEAD"],
        { cwd: root, encoding: "utf8" },
      ).trim();
      expect(report.sourceSha).toBe(checkout);
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
                failed: verdict === "green" ? 0 : 1,
                deferred: verdict === "green" ? 1 : 0,
                not_checked: 0,
                skipped_excluded: 0,
              },
      );
      expect(report.cells[1]?.deferralEvaluation?.status).toBe(deferralStatus);
      const markdown = readFileSync(join(directory, "report.md"), "utf8");
      expect(markdown).toContain("skipped/excluded=0");
      expect(markdown).toContain(
        `deferred=${verdict === "green" || scenario === "no-observations" ? "1" : "0"}`,
      );
      expect(markdown).toContain(
        `Source SHA (checked-out runner): \`${report.sourceSha}\``,
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
