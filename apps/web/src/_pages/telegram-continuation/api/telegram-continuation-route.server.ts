import "server-only";
import { handleAuthenticatedRead } from "@/shared/auth/index.server";
import { requestTelegramActivationContinuation } from "@/shared/api/backend/index.server";
import { telegramContinuationSchema } from "../model/telegram-continuation";

export function handleTelegramContinuationRead(
  attemptId: string,
): Promise<Response> {
  return handleAuthenticatedRead(async (accessToken) => {
    const result = await requestTelegramActivationContinuation(
      attemptId,
      accessToken,
    );
    if (!result.ok)
      return new Response(null, {
        status: result.response.status === 401 ? 401 : 503,
      });
    const parsed = telegramContinuationSchema.safeParse(result.body);
    return parsed.success
      ? Response.json(parsed.data)
      : new Response(null, { status: 503 });
  });
}
