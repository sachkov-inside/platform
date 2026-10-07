import "server-only";

import { requestSetReaderProductMode } from "@/shared/api/backend/index.server";
import { handleAuthenticatedMutation } from "@/shared/auth/index.server";
import { productModeSchema } from "@/shared/product-mode";

/** Сохраняет режим вошедшего читателя. Гость держит своё значение в cookie и сюда не приходит. */
export function handleSetReaderProductMode(request: Request) {
  return handleAuthenticatedMutation(request, async (form, token) => {
    const parsed = productModeSchema.safeParse(form.get("productMode"));
    if (!parsed.success) return { kind: "invalid_input" };
    try {
      const result = await requestSetReaderProductMode(parsed.data, token);
      if (!result.ok) {
        return {
          kind: result.response.status === 401 ? "unauthorized" : "unavailable",
        };
      }
      return { kind: "saved" };
    } catch {
      return { kind: "unavailable" };
    }
  });
}
