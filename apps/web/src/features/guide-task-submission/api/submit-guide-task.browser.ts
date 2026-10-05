import { requestSameOriginMutation } from "@/shared/api/same-origin-mutation";

import {
  submitGuideTaskResultSchema,
  type SubmitGuideTaskInput,
  type SubmitGuideTaskResult,
} from "../model/guide-task-submission";

export async function submitGuideTask(
  input: SubmitGuideTaskInput,
): Promise<SubmitGuideTaskResult> {
  const form = new FormData();
  form.set("code", input.code);
  form.set("taskVersion", String(input.taskVersion));
  form.set("submissionKey", input.submissionKey);
  form.set("note", input.note);
  if (input.repositoryUrl !== undefined)
    form.set("repositoryUrl", input.repositoryUrl);
  if (input.reportText !== undefined) form.set("reportText", input.reportText);
  const response = await requestSameOriginMutation(
    "/api/guide-tasks/submissions",
    "POST",
    form,
  );
  if (!response.ok)
    return response.status === 401
      ? { kind: "unauthorized" }
      : { kind: "unavailable" };
  const parsed = submitGuideTaskResultSchema.safeParse(response.body);
  return parsed.success ? parsed.data : { kind: "unavailable" };
}
