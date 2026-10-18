import { z } from "zod";
import { taskDefinitionSchema } from "../../../../apps/backend/src/modules/product-tasks/domain/task-definition.js";
import { isDeepStrictEqual } from "node:util";
import { reviewReportSchema } from "../../../../apps/backend/src/modules/product-tasks/domain/review-report.js";
export { unconsentedReviewCommands } from "./command-audit.mjs";

export const chapterTaskCodes = [
  "aie-ch1-harness",
  "aie-ch1-running-skeleton",
  "aie-ch1-quality-checks",
] as const;
const frozenTask = z
  .object({
    code: z.enum(chapterTaskCodes),
    title: z.string(),
    path: z.string(),
    sha256: z.hash("sha256"),
    definition: taskDefinitionSchema,
  })
  .strict();
export const chapterSnapshotSchema = z
  .object({
    repository: z.literal("sachkov-inside/engineering-content"),
    commit: z.string().regex(/^[a-f0-9]{40}$/u),
    chapter: z.literal("project-setup"),
    tasks: z.array(frozenTask).length(3),
  })
  .strict()
  .refine(
    (value) =>
      chapterTaskCodes.every(
        (code) => value.tasks.filter((task) => task.code === code).length === 1,
      ),
    "Exactly the three active chapter-one tasks are required",
  );

export type ChapterSnapshot = z.infer<typeof chapterSnapshotSchema>;
export type Expectations = Readonly<Record<string, readonly string[]>>;

/** Expected outcomes are authored outside the learner project, never inferred from its report. */
export function assessReport(input: unknown, expected: Expectations): string[] {
  const parsed = reviewReportSchema.safeParse(input);
  if (!parsed.success) return ["invalid_report"];
  const failures: string[] = [];
  const seen = new Set<string>();
  for (const criterion of parsed.data.criteria) {
    if (seen.has(criterion.criterionId))
      failures.push(`duplicate:${criterion.criterionId}`);
    seen.add(criterion.criterionId);
    if (criterion.obtainedByRun)
      failures.push(`run-claim-needs-review:${criterion.criterionId}`);
    if (expected[criterion.criterionId]?.includes(criterion.status) !== true)
      failures.push(`status:${criterion.criterionId}:${criterion.status}`);
    if (criterion.status === "confirmed" && criterion.evidence.trim() === "")
      failures.push(`evidence:${criterion.criterionId}`);
    if (criterion.status !== "confirmed" && criterion.gap.trim() === "")
      failures.push(`gap:${criterion.criterionId}`);
  }
  for (const id of Object.keys(expected))
    if (!seen.has(id)) failures.push(`missing:${id}`);
  return failures;
}

/** The nullable shape is both the displayed confirmation and persisted service mark. */
export const confirmedReviewSchema = z
  .object({
    code: z.string().min(1),
    taskVersion: z.number().int().positive(),
    reviewReport: reviewReportSchema.required(),
    note: z.string().max(1000),
    serviceMark: z
      .object({
        repositoryUrl: z.string().nullable(),
        branch: z.string().nullable(),
        commit: z.string().nullable(),
        uncommittedChanges: z.boolean().nullable(),
      })
      .strict(),
  })
  .strict();

export const receiptSchema = z.object({
  ok: z.literal(true),
  value: z.object({
    submissionId: z.uuid(),
    code: z.string(),
    taskVersion: z.number().int().positive(),
  }),
});

/** A previous matching report cannot establish that this confirmed submission was saved. */
export function assessSavedSubmission(
  confirmed: z.infer<typeof confirmedReviewSchema>,
  receipt: unknown,
  history: unknown,
): string[] {
  const parsed = receiptSchema.safeParse(receipt);
  if (
    !parsed.success ||
    parsed.data.value.code !== confirmed.code ||
    parsed.data.value.taskVersion !== confirmed.taskVersion
  )
    return ["submission-receipt-not-successful-or-mismatched"];
  const saved = z
    .object({
      ok: z.literal(true),
      value: z.object({
        submissions: z.array(
          z.object({
            submissionId: z.string(),
            taskVersion: z.number(),
            reviewReport: reviewReportSchema.nullable(),
            note: z.string(),
            serviceMark: confirmedReviewSchema.shape.serviceMark,
          }),
        ),
      }),
    })
    .safeParse(history);
  const item = saved.success
    ? saved.data.value.submissions.find(
        (entry) => entry.submissionId === parsed.data.value.submissionId,
      )
    : undefined;
  return item !== undefined &&
    item.taskVersion === confirmed.taskVersion &&
    item.note === confirmed.note &&
    isDeepStrictEqual(item.reviewReport, confirmed.reviewReport) &&
    isDeepStrictEqual(item.serviceMark, confirmed.serviceMark)
    ? []
    : ["confirmed-submission-not-found-in-history"];
}
