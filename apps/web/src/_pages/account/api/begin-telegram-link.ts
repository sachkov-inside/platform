import "server-only";

import {
  requestTelegramMembershipLinkBegin,
  type BackendTransportResult,
} from "@/shared/api/backend/index.server";

import type { TelegramLinkMutationResult } from "@/features/account-access/model/account-telegram-membership";
import {
  mapTelegramLinkMutationResult,
  unavailableTelegramLinkMutation,
} from "./telegram-link-mutation-result";

export async function executeBeginTelegramLink(
  _formData: FormData,
  accessToken: string,
  request: typeof requestTelegramMembershipLinkBegin =
    requestTelegramMembershipLinkBegin,
): Promise<TelegramLinkMutationResult> {
  let result: BackendTransportResult;
  try {
    result = await request(accessToken);
  } catch (error) {
    return unavailableTelegramLinkMutation(error);
  }
  return mapTelegramLinkMutationResult(result);
}
