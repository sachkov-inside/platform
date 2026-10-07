import { z } from "zod";

import {
  submissionSourceSchema,
  taskDefinitionSchema,
  type SubmissionSource,
  type TaskDefinition,
} from "../../domain/task-definition.js";

import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import type { Subject } from "../../../content-access/index.js";
import {
  reviewReportSchema,
  type ReviewReport,
} from "../../domain/review-report.js";
import {
  decideTaskAccess,
  findCurrentTask,
  type LearningTaskDependencies,
} from "../../shared/learning-task-dependencies.js";
import {
  scope,
  systemFailure,
  type Result,
  type SystemError,
} from "../../shared/result.js";

const MAX_SUBMISSIONS = 50;

export const taskSubmissionsQuerySchema = z
  .object({ code: z.string().trim().min(1).max(120) })
  .strict();

export interface OwnTaskSubmission {
  readonly submissionId: string;
  readonly taskVersion: number;
  readonly source: SubmissionSource;
  readonly submittedAt: string;
  readonly reviewReport: ReviewReport | null;
  /** The learner's own report typed into the page form; `null` for an agent's submission. */
  readonly reportText: string | null;
  readonly note: string;
  readonly serviceMark: {
    readonly repositoryUrl: string | null;
    readonly branch: string | null;
    readonly commit: string | null;
    readonly uncommittedChanges: boolean | null;
  };
  readonly authorFeedback: {
    readonly comment: string | null;
    readonly reviewedAt: string | null;
  } | null;
}

export type ListTaskSubmissionsError =
  | { readonly code: "invalid_request_shape" }
  | { readonly code: "task_not_available" }
  | SystemError;

/** The criteria of one Task Version that a listed submission refers to. */
export interface SubmittedVersion {
  readonly version: number;
  readonly criteria: TaskDefinition["criteria"];
}

/**
 * The subject's own submissions of one task, newest first, with the author's feedback when it
 * exists and the criteria of every version they refer to. Another Account's submissions never appear. Submissions outlive a lost access: they
 * return once the task opens to the subject again.
 */
export async function listTaskSubmissions(
  dependencies: LearningTaskDependencies,
  input: { readonly subject: Subject } & Readonly<Record<string, unknown>>,
): Promise<
  Result<
    {
      readonly code: string;
      readonly currentVersion: number;
      readonly versions: readonly SubmittedVersion[];
      readonly submissions: readonly OwnTaskSubmission[];
    },
    ListTaskSubmissionsError
  >
> {
  const { subject, ...query } = input;
  const parsed = taskSubmissionsQuerySchema.safeParse(query);
  if (!parsed.success || subject.kind !== "account")
    return { ok: false, error: { code: "invalid_request_shape" } };
  try {
    const task = await findCurrentTask(dependencies.prisma, parsed.data.code);
    if (task === null)
      return { ok: false, error: { code: "task_not_available" } };
    const access = await decideTaskAccess(
      dependencies.contentAccess,
      subject,
      task.id,
      "product_task_read",
    );
    if (access === "unavailable")
      return {
        ok: false,
        error: { code: "dependency_unavailable", retryable: true },
      };
    if (access === "closed")
      return { ok: false, error: { code: "task_not_available" } };
    const rows = await dependencies.prisma.productTaskSubmission.findMany({
      where: { accountId: subject.accountId, taskId: task.id },
      orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
      take: MAX_SUBMISSIONS,
      include: { feedback: true },
    });
    const versionNumbers = [...new Set(rows.map((row) => row.taskVersion))];
    const versions =
      versionNumbers.length === 0
        ? []
        : await dependencies.prisma.productTaskVersion.findMany({
            where: { taskId: task.id, version: { in: versionNumbers } },
            orderBy: { version: "desc" },
          });
    return {
      ok: true,
      value: {
        code: task.code,
        currentVersion: task.version,
        versions: versions.map((version) => ({
          version: version.version,
          criteria: taskDefinitionSchema.parse(version.definition).criteria,
        })),
        submissions: rows.map((row) => ({
          submissionId: row.id,
          taskVersion: row.taskVersion,
          source: submissionSourceSchema.parse(row.source),
          submittedAt: row.submittedAt.toISOString(),
          reviewReport:
            row.reviewReport === null
              ? null
              : reviewReportSchema.parse(row.reviewReport),
          reportText: row.reportText,
          note: row.note,
          serviceMark: {
            repositoryUrl: row.repositoryUrl,
            branch: row.branch,
            commit: row.commitSha,
            uncommittedChanges: row.uncommittedChanges,
          },
          authorFeedback:
            row.feedback === null
              ? null
              : {
                  comment: row.feedback.comment,
                  reviewedAt: row.feedback.reviewedAt?.toISOString() ?? null,
                },
        })),
      },
    };
  } catch (error) {
    return dependencyFailure(
      scope("listTaskSubmissions"),
      error,
      systemFailure(error),
    );
  }
}
