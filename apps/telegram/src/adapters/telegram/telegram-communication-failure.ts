import { GrammyError } from "grammy";
import type { TelegramDeliveryResult } from "../../modules/outbound/telegram-messages.js";
export function telegramCommunicationFailure(
  error: unknown,
): Exclude<TelegramDeliveryResult, { kind: "delivered" }> {
  if (!(error instanceof GrammyError)) return { kind: "transport_unknown" };
  if (error.error_code === 429 || error.error_code >= 500)
    return {
      kind: "api_retryable",
      providerErrorCode: error.error_code,
      ...(Number.isSafeInteger(error.parameters.retry_after) &&
      (error.parameters.retry_after ?? 0) > 0
        ? { retryAfterSeconds: error.parameters.retry_after }
        : {}),
    };
  return { kind: "api_rejected", providerErrorCode: error.error_code };
}
