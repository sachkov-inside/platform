import { z } from "zod";

/**
 * The page form's limits for input hints only; the backend owns them and refuses anything longer,
 * so a drift shows as `invalid_input`, never as a stored oversize value.
 */
export const SUBMISSION_NOTE_MAX_CHARACTERS = 1_000;
export const SUBMISSION_REPORT_MAX_CHARACTERS = 20_000;
export const SUBMISSION_REPOSITORY_MAX_CHARACTERS = 500;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === "" ? undefined : value))
    .optional();

/** One submission through the task page form (#947): the learner never types a branch or a commit. */
export const submitGuideTaskInputSchema = z
  .object({
    code: z.string().trim().min(1).max(120),
    taskVersion: z.coerce.number().int().positive(),
    submissionKey: z.string().trim().min(1).max(200),
    note: z.string().trim().min(1).max(SUBMISSION_NOTE_MAX_CHARACTERS),
    repositoryUrl: optionalText(SUBMISSION_REPOSITORY_MAX_CHARACTERS).pipe(
      z.url({ protocol: /^https?$/u }).optional(),
    ),
    reportText: optionalText(SUBMISSION_REPORT_MAX_CHARACTERS),
  })
  .strict();

export type SubmitGuideTaskInput = z.input<typeof submitGuideTaskInputSchema>;

export const submitGuideTaskResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("submitted"), submittedAt: z.string() }).strict(),
  z.object({ kind: z.literal("invalid_input") }).strict(),
  z.object({ kind: z.literal("submissions_closed") }).strict(),
  z.object({ kind: z.literal("task_not_available") }).strict(),
  z
    .object({
      kind: z.literal("version_changed"),
      currentVersion: z.number().int().positive(),
    })
    .strict(),
  z.object({ kind: z.literal("rate_limited") }).strict(),
  z.object({ kind: z.literal("unauthorized") }).strict(),
  z.object({ kind: z.literal("unavailable") }).strict(),
]);

export type SubmitGuideTaskResult = z.infer<typeof submitGuideTaskResultSchema>;
