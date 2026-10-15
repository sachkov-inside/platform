import { requestAuthenticatedRead } from "@/shared/api/authenticated-read.browser";
import {
  ownTaskSubmissionsSchema,
  type OwnSubmissionsView,
} from "../model/product-task-page";

export async function readTaskSubmissions(
  code: string,
  after: string | undefined,
  signal: AbortSignal,
): Promise<OwnSubmissionsView> {
  const params = new URLSearchParams({ code });
  if (after !== undefined) params.set("after", after);
  const result = await requestAuthenticatedRead(
    `/api/product-tasks/submissions?${params}`,
    signal,
  );
  if (result.kind === "authentication_required") return { kind: "guest" };
  if (result.kind !== "ready") throw new Error("Task submissions unavailable");
  const value = ownTaskSubmissionsSchema.parse(result.value);
  return { kind: "ready", ...value, continued: after !== undefined };
}
