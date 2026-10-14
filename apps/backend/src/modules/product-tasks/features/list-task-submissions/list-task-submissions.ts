import { createHash } from "node:crypto";
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

const SUBMISSIONS_PAGE_SIZE = 50;
const cursorSchema = z
  .object({
    v: z.literal(1),
    scope: z.string().length(43),
    at: z.iso.datetime(),
    id: z.uuid(),
  })
  .strict();
export const ownSubmissionsCursorSchema = z.string().min(1).max(512);

export const taskSubmissionsQuerySchema = z
  .object({
    code: z.string().trim().min(1).max(120),
    after: ownSubmissionsCursorSchema.optional(),
  })
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
      readonly nextCursor: string | null;
      readonly latestSubmittedAt: string | null;
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
    const cursorScope = createHash("sha256")
      .update(JSON.stringify([subject.accountId.toLowerCase(), task.id]))
      .digest("base64url");
    const cursor =
      parsed.data.after === undefined
        ? undefined
        : decodeCursor(parsed.data.after, cursorScope);
    if (parsed.data.after !== undefined && cursor === undefined)
      return { ok: false, error: { code: "invalid_request_shape" } };
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
    const window = await dependencies.prisma.productTaskSubmission.findMany({
      where: {
        accountId: subject.accountId,
        taskId: task.id,
        ...(cursor === undefined
          ? {}
          : {
              OR: [
                { submittedAt: { lt: new Date(cursor.at) } },
                { submittedAt: new Date(cursor.at), id: { lt: cursor.id } },
              ],
            }),
      },
      orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
      take: SUBMISSIONS_PAGE_SIZE + 1,
      include: { feedback: true },
    });
    const rows = window.slice(0, SUBMISSIONS_PAGE_SIZE);
    const last = rows.at(-1);
    const latest =
      cursor === undefined
        ? rows[0]
        : await dependencies.prisma.productTaskSubmission.findFirst({
            where: { accountId: subject.accountId, taskId: task.id },
            orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
            select: { submittedAt: true },
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
        latestSubmittedAt: latest?.submittedAt.toISOString() ?? null,
        nextCursor:
          window.length > SUBMISSIONS_PAGE_SIZE && last !== undefined
            ? Buffer.from(
                JSON.stringify({
                  v: 1,
                  scope: cursorScope,
                  at: last.submittedAt.toISOString(),
                  id: last.id,
                }),
                "utf8",
              ).toString("base64url")
            : null,
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

function decodeCursor(value: string, scope: string) {
  try {
    const decoded: unknown = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    );
    const parsed = cursorSchema.safeParse(decoded);
    return parsed.success && parsed.data.scope === scope
      ? parsed.data
      : undefined;
  } catch {
    // Not a dependency failure: client cursor is malformed foreign input.
    return undefined;
  }
}
