import { z } from "zod";

const criterionSchema = z
  .object({
    id: z.string(),
    level: z.enum(["required", "additional"]),
    requirement: z.string(),
    acceptableEvidence: z.array(z.string()),
  })
  .strict();

export const authorFeedbackSchema = z
  .object({
    comment: z.string().nullable(),
    reviewedAt: z.iso.datetime().nullable(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export type AuthorFeedback = z.infer<typeof authorFeedbackSchema>;

/** `GET /authoring/product-tasks/submissions` as this page reads it (#948). */
export const taskSubmissionsSchema = z
  .object({
    products: z.array(
      z
        .object({
          id: z.string(),
          name: z.string(),
          chapters: z.array(
            z
              .object({
                id: z.string(),
                name: z.string(),
                tasks: z.array(
                  z.object({ code: z.string(), title: z.string() }).strict(),
                ),
              })
              .strict(),
          ),
        })
        .strict(),
    ),
    submissions: z.array(
      z
        .object({
          submissionId: z.string(),
          submittedAt: z.iso.datetime(),
          source: z.enum(["mcp", "form"]),
          task: z
            .object({
              code: z.string(),
              title: z.string(),
              productId: z.string(),
              productName: z.string().nullable(),
              chapterId: z.string(),
              chapterName: z.string().nullable(),
              currentVersion: z.number().int().positive(),
            })
            .strict(),
          taskVersion: z.number().int().positive(),
          person: z
            .object({
              accountId: z.string(),
              telegramIdentityRef: z.string().nullable(),
            })
            .strict(),
          note: z.string(),
          reviewReport: z
            .object({
              criteria: z.array(
                z
                  .object({
                    criterionId: z.string(),
                    status: z.enum(["confirmed", "violation", "not_verified"]),
                    evidence: z.string(),
                    gap: z.string(),
                    obtainedByRun: z.boolean(),
                  })
                  .strict(),
              ),
            })
            .strict()
            .nullable(),
          reportText: z.string().nullable(),
          serviceMark: z
            .object({
              repositoryUrl: z.string().nullable(),
              branch: z.string().nullable(),
              commit: z.string().nullable(),
              uncommittedChanges: z.boolean().nullable(),
            })
            .strict(),
          authorFeedback: authorFeedbackSchema.nullable(),
        })
        .strict(),
    ),
    versions: z.array(
      z
        .object({
          code: z.string(),
          version: z.number().int().positive(),
          criteria: z.array(criterionSchema),
        })
        .strict(),
    ),
    nextCursor: z.string().nullable(),
  })
  .strict();

export type TaskSubmissions = z.infer<typeof taskSubmissionsSchema>;
export type FilterProduct = TaskSubmissions["products"][number];
export type AuthorSubmission = TaskSubmissions["submissions"][number];
export type TaskCriterion = z.infer<typeof criterionSchema>;

/** The section filter as the address carries it; every part is optional. */
export interface SubmissionSelection {
  readonly productId?: string;
  readonly chapterId?: string;
  readonly taskCode?: string;
}

export const submissionsHref = "/authoring/submissions";

/**
 * The selection that the Products on offer can show: a chapter outside the chosen Product and a task
 * outside the chosen Product or chapter are dropped, so the selects never claim a filter the list
 * does not apply.
 */
export function consistentSelection(
  selection: SubmissionSelection,
  products: readonly FilterProduct[],
): SubmissionSelection {
  const product = products.find((item) => item.id === selection.productId);
  const chapters =
    product === undefined
      ? products.flatMap((item) => item.chapters)
      : product.chapters;
  const chapter =
    product === undefined
      ? undefined
      : chapters.find((item) => item.id === selection.chapterId);
  const tasks = (chapter === undefined ? chapters : [chapter]).flatMap(
    (item) => item.tasks,
  );
  const task = tasks.find((item) => item.code === selection.taskCode);
  return {
    ...(product === undefined ? {} : { productId: product.id }),
    ...(chapter === undefined ? {} : { chapterId: chapter.id }),
    ...(task === undefined ? {} : { taskCode: task.code }),
  };
}

export function sameSelection(
  left: SubmissionSelection,
  right: SubmissionSelection,
): boolean {
  return (
    left.productId === right.productId &&
    left.chapterId === right.chapterId &&
    left.taskCode === right.taskCode
  );
}

/** The address of a filtered list, and of its next page when a cursor is given. */
export function selectionHref(
  selection: SubmissionSelection,
  cursor?: string,
): string {
  const query = new URLSearchParams();
  if (selection.productId !== undefined)
    query.set("productId", selection.productId);
  if (selection.chapterId !== undefined)
    query.set("chapterId", selection.chapterId);
  if (selection.taskCode !== undefined) query.set("task", selection.taskCode);
  if (cursor !== undefined) query.set("cursor", cursor);
  const text = query.toString();
  return text === "" ? submissionsHref : `${submissionsHref}?${text}`;
}

/** The criteria of the version a submission was reviewed against. */
export function criteriaOf(
  submissions: TaskSubmissions,
  submission: AuthorSubmission,
): readonly TaskCriterion[] {
  return (
    submissions.versions.find(
      (version) =>
        version.code === submission.task.code &&
        version.version === submission.taskVersion,
    )?.criteria ?? []
  );
}

/**
 * The learner's repository as a link only when it is a web address: the agent records the service
 * mark itself, so any other scheme stays plain text and never becomes an executable link.
 */
export function repositoryLink(url: string | null): string | null {
  if (url === null) return null;
  const parsed = URL.parse(url);
  return parsed !== null &&
    (parsed.protocol === "https:" || parsed.protocol === "http:")
    ? parsed.href
    : null;
}
