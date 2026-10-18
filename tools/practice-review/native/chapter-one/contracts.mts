import { z } from "zod";
import { taskDefinitionSchema } from "../../../../apps/backend/src/modules/product-tasks/domain/task-definition.js";
import { reviewReportSchema } from "../../../../apps/backend/src/modules/product-tasks/domain/review-report.js";
import { simpleCommands, readsOnly } from "../task-gates.mjs";

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

/** A conservative audit heuristic, not a shell parser or a security sandbox. */
export function unconsentedReviewCommands(
  commands: readonly string[],
): string[] {
  return commands
    .flatMap(simpleCommands)
    .filter(
      (command) =>
        !readsOnly(command) && !/^git worktree list(?:\s|$)/u.test(command),
    );
}

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
      failures.push(`unsupported-run-claim:${criterion.criterionId}`);
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
