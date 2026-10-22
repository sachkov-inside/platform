import "server-only";

import {
  requestTelegramMembershipLinkConfirmation,
  type BackendTransportResult,
} from "@/shared/api/backend/index.server";

import type { TelegramLinkMutationResult } from "@/features/account-access/model/account-telegram-membership";
import {
  mapTelegramLinkMutationResult,
  unavailableTelegramLinkMutation,
} from "./telegram-link-mutation-result";

/** A link reference outside the operation's schema: the same outcome the browser already knows. */
export function invalidTelegramLinkInput(): TelegramLinkMutationResult {
  return { kind: "unavailable", reference: "telegram-link-input" };
}

export async function executeConfirmTelegramLink(
  input: { readonly linkRef: string },
  accessToken: string,
  request: typeof requestTelegramMembershipLinkConfirmation = requestTelegramMembershipLinkConfirmation,
): Promise<TelegramLinkMutationResult> {
  let result: BackendTransportResult;
  try {
    result = await request(input.linkRef, accessToken);
  } catch (error) {
    return unavailableTelegramLinkMutation(error);
  }
  return mapTelegramLinkMutationResult(result);
}
