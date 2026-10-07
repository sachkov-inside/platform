import { requestSameOriginMutation } from "@/shared/api/same-origin-mutation";

import {
  submitProductTaskResultSchema,
  type SubmitProductTaskInput,
  type SubmitProductTaskResult,
} from "../model/product-task-submission";

export async function submitProductTask(
  input: SubmitProductTaskInput,
): Promise<SubmitProductTaskResult> {
  const form = new FormData();
  form.set("code", input.code);
  form.set("taskVersion", String(input.taskVersion));
  form.set("submissionKey", input.submissionKey);
  form.set("note", input.note);
  if (input.repositoryUrl !== undefined)
    form.set("repositoryUrl", input.repositoryUrl);
  if (input.reportText !== undefined) form.set("reportText", input.reportText);
  const response = await requestSameOriginMutation(
    "/api/product-tasks/submissions",
    "POST",
    form,
  );
  if (!response.ok)
    return response.status === 401
      ? { kind: "unauthorized" }
      : { kind: "unavailable" };
  const parsed = submitProductTaskResultSchema.safeParse(response.body);
  return parsed.success ? parsed.data : { kind: "unavailable" };
}
