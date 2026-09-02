import { requestSameOriginMutation } from "@/shared/api/same-origin-mutation";

import type { TelegramLinkMutationResult } from "../model/account-telegram-membership";
import { parseTelegramLinkMutationResponse } from "./telegram-link-mutation-response.browser";

export async function confirmTelegramLink(
  linkRef: string,
): Promise<TelegramLinkMutationResult> {
  const formData = new FormData();
  formData.set("linkRef", linkRef);
  const response = await requestSameOriginMutation(
    "/api/account/telegram-link/confirm",
    "POST",
    formData,
  );
  return parseTelegramLinkMutationResponse(response, "confirm");
}
