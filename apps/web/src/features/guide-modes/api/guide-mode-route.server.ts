import "server-only";

import { requestSetReaderGuideMode } from "@/shared/api/backend/index.server";
import { handleAuthenticatedMutation } from "@/shared/auth/index.server";
import { guideModeSchema } from "@/shared/guide-mode";

/** Сохраняет режим вошедшего читателя. Гость держит своё значение в cookie и сюда не приходит. */
export function handleSetReaderGuideMode(request: Request) {
  return handleAuthenticatedMutation(request, async (form, token) => {
    const parsed = guideModeSchema.safeParse(form.get("guideMode"));
    if (!parsed.success) return { kind: "invalid_input" };
    try {
      const result = await requestSetReaderGuideMode(parsed.data, token);
      if (!result.ok) {
        return { kind: result.response.status === 401 ? "unauthorized" : "unavailable" };
      }
      return { kind: "saved" };
    } catch {
      return { kind: "unavailable" };
    }
  });
}
