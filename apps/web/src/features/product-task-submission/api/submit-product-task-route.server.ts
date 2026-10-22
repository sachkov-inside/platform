import "server-only";

import { z } from "zod";

import {
  BackendConnectionError,
  requestSubmitProductTaskForm,
} from "@/shared/api/backend/index.server";
import { handleMutationOperation } from "@/shared/auth/index.server";

import type { SubmitProductTaskResult } from "../model/product-task-submission";

import { submitProductTaskOperation } from "./submit-product-task.operation";

const receiptSchema = z.object({ submittedAt: z.iso.datetime() }).loose();
const problemSchema = z
  .object({
    code: z.string(),
    currentVersion: z.number().int().positive().optional(),
  })
  .loose();

/** `POST /api/product-tasks/submissions`: the task page form, one submission per call (#947). */
export function handleSubmitProductTask(request: Request): Promise<Response> {
  return handleMutationOperation(request, submitProductTaskOperation, {
    invalidInput: () => ({ kind: "invalid_input" }),
    execute: async (input, token): Promise<SubmitProductTaskResult> => {
      const { code, ...submission } = input;
      try {
        const result = await requestSubmitProductTaskForm(
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
  });
}
