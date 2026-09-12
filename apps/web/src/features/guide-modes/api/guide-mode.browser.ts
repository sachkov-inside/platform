import { requestSameOriginMutation } from "@/shared/api/same-origin-mutation";
import type { GuideMode } from "@/shared/guide-mode";

export async function saveReaderGuideMode(guideMode: GuideMode) {
  const form = new FormData();
  form.set("guideMode", guideMode);
  const result = await requestSameOriginMutation(
    "/api/reading-progress/guide-mode",
    "PUT",
    form,
  );
  return result.ok ? ({ kind: "saved" } as const) : ({ kind: "unavailable" } as const);
}
