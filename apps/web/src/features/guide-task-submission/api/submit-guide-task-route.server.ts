import "server-only";

import { z } from "zod";

import {
  BackendConnectionError,
  requestSubmitGuideTaskForm,
} from "@/shared/api/backend/index.server";
import { handleAuthenticatedMutation } from "@/shared/auth/index.server";

import {
  submitGuideTaskInputSchema,
  type SubmitGuideTaskResult,
} from "../model/guide-task-submission";

const receiptSchema = z.object({ submittedAt: z.iso.datetime() }).loose();
const problemSchema = z
  .object({
    code: z.string(),
    currentVersion: z.number().int().positive().optional(),
  })
  .loose();

/** `POST /api/guide-tasks/submissions`: the task page form, one submission per call (#947). */
export function handleSubmitGuideTask(request: Request): Promise<Response> {
  return handleAuthenticatedMutation(
    request,
    async (form, token): Promise<SubmitGuideTaskResult> => {
      const parsed = submitGuideTaskInputSchema.safeParse({
        code: form.get("code"),
        taskVersion: form.get("taskVersion"),
        submissionKey: form.get("submissionKey"),
        note: form.get("note"),
        repositoryUrl: form.get("repositoryUrl") ?? undefined,
        reportText: form.get("reportText") ?? undefined,
      });
      if (!parsed.success) return { kind: "invalid_input" };
      const { code, ...submission } = parsed.data;
      try {
        const result = await requestSubmitGuideTaskForm(
          code,
          {
            taskVersion: submission.taskVersion,
            submissionKey: submission.submissionKey,
            note: submission.note,
            ...(submission.repositoryUrl === undefined
              ? {}
              : { repositoryUrl: submission.repositoryUrl }),
            ...(submission.reportText === undefined
              ? {}
              : { reportText: submission.reportText }),
          },
          token,
        );
        if (result.ok) {
          const receipt = receiptSchema.safeParse(result.body);
          return receipt.success
            ? { kind: "submitted", submittedAt: receipt.data.submittedAt }
            : { kind: "unavailable" };
        }
        const problem = problemSchema.safeParse(result.problem);
        switch (result.response.status) {
          case 400:
            return { kind: "invalid_input" };
          case 401:
            return { kind: "unauthorized" };
          case 403:
            return { kind: "submissions_closed" };
          case 404:
            return { kind: "task_not_available" };
          case 409:
            return problem.success &&
              problem.data.code === "task_version_changed" &&
              problem.data.currentVersion !== undefined
              ? {
                  kind: "version_changed",
                  currentVersion: problem.data.currentVersion,
                }
              : { kind: "unavailable" };
          case 429:
            return { kind: "rate_limited" };
          default:
            return { kind: "unavailable" };
        }
      } catch (error) {
        if (error instanceof BackendConnectionError)
          return { kind: "unavailable" };
        throw error;
      }
    },
  );
}
