import { requestSameOriginMutation } from "@/shared/api/same-origin-mutation";

import type { TelegramLinkMutationResult } from "../model/account-telegram-membership";
import { parseTelegramLinkMutationResponse } from "./telegram-link-mutation-response.browser";

export async function beginTelegramLink(): Promise<TelegramLinkMutationResult> {
  const response = await requestSameOriginMutation(
    "/api/account/telegram-link/begin",
    "POST",
    new FormData(),
  );
  return parseTelegramLinkMutationResponse(response, "begin");
}
