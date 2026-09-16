import "server-only";

import { z } from "zod";

import {
  completeTelegramAccountSignIn,
  requestAcceptTerms,
} from "@/shared/api/backend/index.server";
import { isTelegramSignInToken } from "@/shared/auth/telegram-sign-in-token.server";

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
    readonly completeTelegramSignIn: typeof completeTelegramAccountSignIn;
  } = { accept: requestAcceptTerms, completeTelegramSignIn: completeTelegramAccountSignIn },
): Promise<AcceptTermsResult> {
  let input: z.infer<typeof acceptTermsInputSchema>;
  try {
    input = acceptTermsInputSchema.parse(JSON.parse(z.string().parse(form.get("input"))));
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
  // Вход через Telegram откладывает связку с ботом до принятия условий. Пока жив токен входа,
  // её завершает тот же вызов, что и при входе; иначе человек подключит Telegram в кабинете.
  if (isTelegramSignInToken(accessToken)) {
    try {
      await dependencies.completeTelegramSignIn(accessToken);
    } catch {
      // Условия уже приняты: незавершённая связка не отменяет принятие.
    }
  }
  return { kind: "accepted" };
}
