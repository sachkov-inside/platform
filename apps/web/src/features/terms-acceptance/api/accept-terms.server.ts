import "server-only";

import { z } from "zod";

import {
  resumeTelegramAccountSignIn,
  requestAcceptTerms,
} from "@/shared/api/backend/index.server";

import {
  acceptTermsInputSchema,
  termsAcceptanceButtonLabel,
  type AcceptTermsResult,
} from "../model/terms-acceptance";

/**
 * Принятие условий кнопкой экрана первого входа: подпись кнопки ставит сервер Web, браузер
 * присылает только операцию и редакцию, которую видел.
 */
export async function executeAcceptTerms(
  form: FormData,
  accessToken: string,
  dependencies: {
    readonly accept: typeof requestAcceptTerms;
    readonly resumeTelegramSignIn: typeof resumeTelegramAccountSignIn;
  } = {
    accept: requestAcceptTerms,
    resumeTelegramSignIn: resumeTelegramAccountSignIn,
  },
): Promise<AcceptTermsResult> {
  let input: z.infer<typeof acceptTermsInputSchema>;
  try {
    input = acceptTermsInputSchema.parse(
      JSON.parse(z.string().parse(form.get("input"))),
    );
  } catch {
    return { kind: "unavailable" };
  }
  try {
    const result = await dependencies.accept(
      { ...input, buttonLabel: termsAcceptanceButtonLabel },
      accessToken,
    );
    if (!result.ok) {
      if (result.response.status === 401) return { kind: "unauthorized" };
      const code = z.object({ code: z.string() }).safeParse(result.problem);
      return code.success && code.data.code === "document_changed"
        ? { kind: "document_changed" }
        : { kind: "unavailable" };
    }
  } catch {
    return { kind: "unavailable" };
  }
  // Refresh no longer carries sign-in proof. Backend resumes only a previously verified receipt
  // of this Account and does nothing for an email sign-in without such a receipt.
  try {
    await dependencies.resumeTelegramSignIn(accessToken);
  } catch {
    // Условия уже приняты: незавершённая связка не отменяет принятие.
  }
  return { kind: "accepted" };
}
