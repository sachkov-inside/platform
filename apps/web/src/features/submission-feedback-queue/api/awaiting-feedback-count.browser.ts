import { requestAuthenticatedRead } from "@/shared/api/authenticated-read.browser";

import {
  awaitingFeedbackCountStateSchema,
  type AwaitingFeedbackCountState,
} from "../model/awaiting-feedback-count";

export const awaitingFeedbackCountPath =
  "/api/authoring/product-tasks/awaiting-feedback-count";

export async function requestAwaitingFeedbackCount(
  signal: AbortSignal,
): Promise<AwaitingFeedbackCountState> {
  const result = await requestAuthenticatedRead(
    awaitingFeedbackCountPath,
    signal,
  );
  if (result.kind === "authentication_required") return { kind: "signed_out" };
  if (result.kind === "rejected") {
    const parsed = awaitingFeedbackCountStateSchema.safeParse(result.body);
    return parsed.success && parsed.data.kind !== "ready"
      ? parsed.data
      : { kind: "unavailable", reference: result.reference ?? "counter" };
  }
  if (result.kind !== "ready")
    return { kind: "unavailable", reference: result.reference ?? "counter" };
  const parsed = awaitingFeedbackCountStateSchema.safeParse(result.value);
  return parsed.success && parsed.data.kind === "ready"
    ? parsed.data
    : { kind: "unavailable", reference: "malformed-response" };
}
