import { z } from "zod";
import type { TaskDefinition } from "./task-definition.js";

/** Storage protection, not a limit on the learner: a full report of 50 criteria fits easily. */
export const REVIEW_REPORT_MAX_BYTES = 64 * 1024;
export const SUBMISSION_NOTE_MAX_CHARACTERS = 1_000;

const reportText = z.string().trim().max(4_000);

/**
 * The learner agent's report on one Task Version: exactly one status per criterion. The report is
 * the agent's own statement, untrusted text for the author, never a Platform verdict.
 */
export const reviewReportSchema = z
  .object({
    criteria: z
      .array(
        z
          .object({
            criterionId: z.string().min(1).max(100),
            status: z.enum(["confirmed", "violation", "not_verified"]),
            evidence: reportText,
            gap: reportText,
            obtainedByRun: z.boolean(),
          })
          .strict(),
      )
      .min(1)
      .max(50),
  })
  .strict()
  .superRefine((value, context) => {
    if (Buffer.byteLength(JSON.stringify(value), "utf8") > REVIEW_REPORT_MAX_BYTES)
      context.addIssue({
        code: "custom",
        message: "Review report exceeds 64 KiB",
      });
  });

/** Optional facts the agent records about what it reviewed; the learner does not fill them. */
export const serviceMarkSchema = z
  .object({
    repositoryUrl: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .refine(
        (value) =>
          !Array.from(value).some((character) => character.charCodeAt(0) < 32),
        "Expected printable text",
      )
      .optional(),
    branch: z.string().trim().min(1).max(250).optional(),
    commit: z
      .string()
      .regex(/^[0-9a-f]{7,64}$/u)
      .optional(),
    uncommittedChanges: z.boolean().optional(),
  })
  .strict();

export type ReviewReport = z.infer<typeof reviewReportSchema>;
export type ServiceMark = z.infer<typeof serviceMarkSchema>;

export type ReportCoverage =
  | { readonly covered: true }
  | {
      readonly covered: false;
      readonly missing: readonly string[];
      readonly unexpected: readonly string[];
      readonly duplicated: readonly string[];
    };

/** The report covers every criterion of its version and only them, each exactly once. */
export function checkReportCoverage(
  report: ReviewReport,
  definition: TaskDefinition,
): ReportCoverage {
  const expected = new Set(definition.criteria.map((criterion) => criterion.id));
  const seen = new Set<string>();
  const duplicated = new Set<string>();
  for (const { criterionId } of report.criteria) {
    if (seen.has(criterionId)) duplicated.add(criterionId);
    seen.add(criterionId);
  }
  const missing = [...expected].filter((id) => !seen.has(id));
  const unexpected = [...seen].filter((id) => !expected.has(id));
  return missing.length === 0 &&
    unexpected.length === 0 &&
    duplicated.size === 0
    ? { covered: true }
    : { covered: false, missing, unexpected, duplicated: [...duplicated] };
}
