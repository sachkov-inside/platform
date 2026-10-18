import { requestAuthenticatedRead } from "@/shared/api/authenticated-read.browser";
import {
  telegramContinuationSchema,
  type TelegramContinuation,
} from "../model/telegram-continuation";

type ContinuationRead =
  | TelegramContinuation
  | {
      readonly state:
        "unauthorized" | "identity_unavailable" | "dependency_unavailable";
      readonly reference?: string;
    };

/** Validate the Product continuation while preserving authenticated read failures. */
export async function requestTelegramContinuation(
  attemptId: string,
  signal?: AbortSignal,
): Promise<ContinuationRead> {
  const result = await requestAuthenticatedRead(
    `/api/account/telegram-activation/${encodeURIComponent(attemptId)}`,
    signal,
  );
  if (result.kind === "ready") {
    const parsed = telegramContinuationSchema.safeParse(result.value);
    return parsed.success
      ? parsed.data
      : {
          state: "dependency_unavailable",
          reference: "telegram-continuation-contract",
        };
  }
  const diagnostic =
    result.reference === undefined ? {} : { reference: result.reference };
  if (result.kind === "authentication_required")
    return { state: "unauthorized", ...diagnostic };
  if (result.kind === "identity_unavailable")
    return { state: "identity_unavailable", ...diagnostic };
  return { state: "dependency_unavailable", ...diagnostic };
}
