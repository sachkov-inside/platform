import { z } from "zod";
import { commandDigest } from "../../../../infrastructure/contracts/canonical-digest.js";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import {
  Prisma,
  lockProductTaskSubmissions,
} from "../../../../infrastructure/prisma/index.js";
import type { Subject } from "../../../content-access/index.js";
import {
  checkReportCoverage,
  reviewReportSchema,
} from "../../domain/review-report.js";
import {
  reviewProgressSchema,
  type ReviewProgress,
} from "../../domain/review-progress.js";
import { taskCodeSchema } from "../../domain/task-definition.js";
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

export const taskReviewUpdateSchema = z
  .object({
    code: taskCodeSchema,
    taskVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    runKey: z.uuid(),
    expectedRevision: z.number().int().min(0).max(2_000_000_000),
    phase: z.enum(["reviewing", "ready", "stopped"]),
    summary: z.string().trim().min(1).max(1000),
    reviewReport: reviewReportSchema.optional(),
  })
  .strict()
  .refine(
    (value) => value.phase !== "ready" || value.reviewReport !== undefined,
    "A ready review includes its complete report",
  );

type UpdateError =
  | {
      readonly code:
        | "invalid_request_shape"
        | "submissions_disabled"
        | "task_not_available"
        | "report_coverage_mismatch";
    }
  | { readonly code: "task_version_changed"; readonly currentVersion: number }
  | { readonly code: "review_conflict"; readonly currentRevision: number }
  | SystemError;

/** Serializes progress with submission; a stale agent cannot revive a closed or superseded run. */
export async function updateTaskReview(
  dependencies: LearningTaskDependencies,
  input: { readonly subject: Subject } & Readonly<Record<string, unknown>>,
): Promise<Result<ReviewProgress, UpdateError>> {
  if (!dependencies.submissionsEnabled)
    return { ok: false, error: { code: "submissions_disabled" } };
  const { subject, ...body } = input;
  const parsed = taskReviewUpdateSchema.safeParse(body);
  if (!parsed.success || subject.kind !== "account")
    return { ok: false, error: { code: "invalid_request_shape" } };
  const command = parsed.data;
  try {
    const known = await findCurrentTask(dependencies.prisma, command.code);
    if (known === null)
      return { ok: false, error: { code: "task_not_available" } };
    const access = await decideTaskAccess(
      dependencies.contentAccess,
      subject,
      known.id,
      "product_task_submit",
    );
    if (access === "closed")
      return { ok: false, error: { code: "task_not_available" } };
    if (access === "unavailable")
      return {
        ok: false,
        error: { code: "dependency_unavailable", retryable: true },
      };
    return await dependencies.prisma.$transaction(async (transaction) => {
      await lockProductTaskSubmissions(transaction, subject.accountId);
      const task = await findCurrentTask(transaction, command.code);
      if (task === null || task.id !== known.id)
        return { ok: false, error: { code: "task_not_available" } };
      if (task.version !== command.taskVersion)
        return {
          ok: false,
          error: { code: "task_version_changed", currentVersion: task.version },
        };
      const where = {
        accountId_taskId: { accountId: subject.accountId, taskId: task.id },
      };
      const previous = await transaction.productTaskReviewProgress.findUnique({
        where,
      });
      // Immutable submissions retain closed run keys after current progress moves to another run.
      const closed = await transaction.productTaskSubmission.findFirst({
        where: {
          accountId: subject.accountId,
          taskId: task.id,
          reviewRunKey: command.runKey,
        },
        select: { id: true },
      });
      if (closed !== null)
        return {
          ok: false,
          error: {
            code: "review_conflict",
            currentRevision: previous?.revision ?? 0,
          },
        };
      const fingerprint = commandDigest(command);
      // A lost-response retry must neither advance the revision nor reopen submitted work.
      if (
        previous?.requestFingerprint === fingerprint &&
        previous.phase !== "submitted"
      )
        return { ok: true, value: progressView(previous) };
      const currentRevision = previous?.revision ?? 0;
      if (
        command.expectedRevision !== currentRevision ||
        (previous?.runKey === command.runKey &&
          previous.phase === "submitted") ||
        (previous?.runKey !== command.runKey && command.phase !== "reviewing")
      )
        return {
          ok: false,
          error: { code: "review_conflict", currentRevision },
        };
      if (
        command.reviewReport !== undefined &&
        !checkReportCoverage(command.reviewReport, task.definition).covered
      )
        return { ok: false, error: { code: "report_coverage_mismatch" } };
      const now = (dependencies.clock ?? (() => new Date()))();
      const data = {
        taskVersion: task.version,
        runKey: command.runKey,
        revision: currentRevision + 1,
        phase: command.phase,
        summary: command.summary,
        requestFingerprint: fingerprint,
        updatedAt: now,
      };
      // Replace the whole snapshot. A new run never inherits a previous run's report.
      const row = await transaction.productTaskReviewProgress.upsert({
        where,
        create: {
          accountId: subject.accountId,
          taskId: task.id,
          ...data,
          ...(command.reviewReport === undefined
            ? {}
            : { reviewReport: command.reviewReport }),
        },
        update: {
          ...data,
          reviewReport: command.reviewReport ?? Prisma.DbNull,
        },
      });
      return { ok: true, value: progressView(row) };
    });
  } catch (error) {
    return dependencyFailure(
      scope("updateTaskReview"),
      error,
      systemFailure(error),
    );
  }
}

function progressView(row: {
  taskVersion: number;
  runKey: string;
  revision: number;
  phase: string;
  summary: string;
  reviewReport: unknown;
  updatedAt: Date;
}): ReviewProgress {
  return reviewProgressSchema.parse({
    taskVersion: row.taskVersion,
    runKey: row.runKey,
    revision: row.revision,
    phase: row.phase,
    summary: row.summary,
    reviewReport: row.reviewReport,
    updatedAt: row.updatedAt.toISOString(),
  });
}
