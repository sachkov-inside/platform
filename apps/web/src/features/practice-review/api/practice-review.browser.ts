import { z } from "zod";

import { requestSameOriginMutation } from "@/shared/api/same-origin-mutation";

import { reviewRefusalCodeSchema } from "../model/practice-review";

const requestResultSchema = z.union([
  z.object({ ok: z.literal(true), reviewId: z.uuid() }),
  z.object({ ok: z.literal(false), code: reviewRefusalCodeSchema }),
]);
export type RequestPracticeReviewResult =
  | z.infer<typeof requestResultSchema>
  | { readonly ok: false; readonly code: "unauthorized" };

/** «Проверить задание» со страницы урока. */
export async function requestPracticeReview(input: {
  readonly practiceId: string;
  readonly expectedContextVersion: string;
}): Promise<RequestPracticeReviewResult> {
  const form = new FormData();
  form.set("practiceId", input.practiceId);
  form.set("expectedContextVersion", input.expectedContextVersion);
  const response = await requestSameOriginMutation(
    "/api/account/course-assistant/practice-reviews",
    "POST",
    form,
  );
  if (!response.ok)
    return {
      ok: false,
      code: response.status === 401 ? "unauthorized" : "unavailable",
    };
  const parsed = requestResultSchema.safeParse(response.body);
  return parsed.success ? parsed.data : { ok: false, code: "unavailable" };
}
