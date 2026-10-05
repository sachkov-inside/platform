import { randomUUID } from "node:crypto";
import { z } from "zod";

import { commandDigest } from "../../../../infrastructure/contracts/canonical-digest.js";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import {
  lockGuideTaskSubmissions,
  type GuideTasksPrisma,
} from "../../../../infrastructure/prisma/index.js";
import type { Subject } from "../../../content-access/index.js";
import {
  checkReportCoverage,
  reviewReportSchema,
  serviceMarkSchema,
  SUBMISSION_NOTE_MAX_CHARACTERS,
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

/** Storage protection: an Account submits at most this many times per rolling hour. */
export const SUBMISSIONS_PER_HOUR = 20;
const SUBMISSION_WINDOW_MILLISECONDS = 60 * 60 * 1_000;

export const taskSubmissionSchema = z
  .object({
    code: z.string().trim().min(1).max(120),
    taskVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    /** One key per submission; a retry of the same content reuses it. */
    submissionKey: z.string().trim().min(1).max(200),
    reviewReport: reviewReportSchema,
    note: z.string().trim().max(SUBMISSION_NOTE_MAX_CHARACTERS),
    serviceMark: serviceMarkSchema.optional(),
  })
  .strict();

export type TaskSubmissionInput = z.infer<typeof taskSubmissionSchema>;

export interface TaskSubmissionReceipt {
  readonly submissionId: string;
  readonly code: string;
  readonly taskVersion: number;
  readonly source: "mcp" | "form";
  readonly submittedAt: string;
}

export type SubmitTaskError =
  | { readonly code: "invalid_request_shape" }
  | { readonly code: "submissions_disabled" }
  | { readonly code: "task_not_available" }
  | {
      readonly code: "task_version_changed";
      readonly submittedVersion: number;
      readonly currentVersion: number;
    }
  | {
      readonly code: "report_coverage_mismatch";
      readonly missing: readonly string[];
      readonly unexpected: readonly string[];
      readonly duplicated: readonly string[];
    }
  | { readonly code: "submission_rate_limited" }
  | { readonly code: "idempotency_conflict" }
  | SystemError;

/**
 * Appends one submission of the subject against the task version its agent reviewed. Access is
 * decided at every submission; a report must cover every criterion of that version and only them;
 * a version that is no longer current is refused. The same submission key with the same content
 * answers with the first receipt; Platform never fetches the repository URL it stores.
 */
export async function submitTask(
  dependencies: LearningTaskDependencies,
  input: {
    readonly subject: Subject;
    readonly source: "mcp" | "form";
    readonly submission: unknown;
  },
): Promise<Result<TaskSubmissionReceipt, SubmitTaskError>> {
  if (!dependencies.submissionsEnabled)
    return { ok: false, error: { code: "submissions_disabled" } };
  const parsed = taskSubmissionSchema.safeParse(input.submission);
  if (!parsed.success || input.subject.kind !== "account")
    return { ok: false, error: { code: "invalid_request_shape" } };
  const command = parsed.data;
  const accountId = input.subject.accountId;
  const fingerprint = commandDigest({ source: input.source, ...command });
  const clock = dependencies.clock ?? (() => new Date());
  class Rollback extends Error {
    constructor(readonly submitError: SubmitTaskError) {
      super(submitError.code);
    }
  }
  try {
    const replayed = await replay(
      dependencies.prisma,
      accountId,
      command,
      fingerprint,
    );
    if (replayed !== undefined) return replayed;
    const known = await findCurrentTask(dependencies.prisma, command.code);
    if (known === null)
      return { ok: false, error: { code: "task_not_available" } };
    // Access is read before the transaction: it needs other connections.
    const access = await decideTaskAccess(
      dependencies.contentAccess,
      input.subject,
      known.id,
      "guide_task_submit",
    );
    if (access === "unavailable")
      return {
        ok: false,
        error: { code: "dependency_unavailable", retryable: true },
      };
    if (access === "closed")
      return { ok: false, error: { code: "task_not_available" } };
    const receipt = await dependencies.prisma.$transaction(
      async (transaction): Promise<TaskSubmissionReceipt> => {
        await lockGuideTaskSubmissions(transaction, accountId);
        const raced = await replay(transaction, accountId, command, fingerprint);
        if (raced !== undefined) {
          if (raced.ok) return raced.value;
          throw new Rollback(raced.error);
        }
        const task = await findCurrentTask(transaction, command.code);
        if (task === null || task.id !== known.id)
          throw new Rollback({ code: "task_not_available" });
        if (task.version !== command.taskVersion)
          throw new Rollback({
            code: "task_version_changed",
            submittedVersion: command.taskVersion,
            currentVersion: task.version,
          });
        const coverage = checkReportCoverage(
          command.reviewReport,
          task.definition,
        );
        if (!coverage.covered)
          throw new Rollback({
            code: "report_coverage_mismatch",
            missing: coverage.missing,
            unexpected: coverage.unexpected,
            duplicated: coverage.duplicated,
          });
        const now = clock();
        const recent = await transaction.guideTaskSubmission.count({
          where: {
            accountId,
            submittedAt: {
              gt: new Date(now.getTime() - SUBMISSION_WINDOW_MILLISECONDS),
            },
          },
        });
        if (recent >= SUBMISSIONS_PER_HOUR)
          throw new Rollback({ code: "submission_rate_limited" });
        const id = randomUUID();
        await transaction.guideTaskSubmission.create({
          data: {
            id,
            accountId,
            taskId: task.id,
            taskVersion: task.version,
            submissionKey: command.submissionKey,
            requestFingerprint: fingerprint,
            source: input.source,
            reviewReport: command.reviewReport,
            note: command.note,
            repositoryUrl: command.serviceMark?.repositoryUrl ?? null,
            branch: command.serviceMark?.branch ?? null,
            commitSha: command.serviceMark?.commit ?? null,
            uncommittedChanges: command.serviceMark?.uncommittedChanges ?? null,
            submittedAt: now,
          },
        });
        return {
          submissionId: id,
          code: task.code,
          taskVersion: task.version,
          source: input.source,
          submittedAt: now.toISOString(),
        };
      },
    );
    return { ok: true, value: receipt };
  } catch (error) {
    if (error instanceof Rollback)
      return { ok: false, error: error.submitError };
    return dependencyFailure(scope("submitTask"), error, systemFailure(error));
  }
}

/** The first answer to a repeated submission key, or a conflict when its content differs. */
async function replay(
  prisma: Pick<GuideTasksPrisma, "guideTaskSubmission" | "guideTask">,
  accountId: string,
  command: TaskSubmissionInput,
  fingerprint: string,
): Promise<Result<TaskSubmissionReceipt, SubmitTaskError> | undefined> {
  const previous = await prisma.guideTaskSubmission.findUnique({
    where: {
      accountId_submissionKey: {
        accountId,
        submissionKey: command.submissionKey,
      },
    },
  });
  if (previous === null) return undefined;
  if (previous.requestFingerprint !== fingerprint)
    return { ok: false, error: { code: "idempotency_conflict" } };
  return {
    ok: true,
    value: {
      submissionId: previous.id,
      code: command.code,
      taskVersion: previous.taskVersion,
      source: z.enum(["mcp", "form"]).parse(previous.source),
      submittedAt: previous.submittedAt.toISOString(),
    },
  };
}
