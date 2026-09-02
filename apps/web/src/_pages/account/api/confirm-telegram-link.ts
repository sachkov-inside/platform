import "server-only";

import { z } from "zod";

import {
  requestTelegramMembershipLinkConfirmation,
  type BackendTransportResult,
} from "@/shared/api/backend/index.server";

import type { TelegramLinkMutationResult } from "@/features/account-access/model/account-telegram-membership";
import {
  mapTelegramLinkMutationResult,
  unavailableTelegramLinkMutation,
} from "./telegram-link-mutation-result";

const formSchema = z.object({ linkRef: z.uuid() }).strict();

export async function executeConfirmTelegramLink(
  formData: FormData,
  accessToken: string,
  request: typeof requestTelegramMembershipLinkConfirmation =
    requestTelegramMembershipLinkConfirmation,
): Promise<TelegramLinkMutationResult> {
  const parsed = formSchema.safeParse({ linkRef: formData.get("linkRef") });
  if (!parsed.success) {
    return { kind: "unavailable", reference: "telegram-link-input" };
  }
  let result: BackendTransportResult;
  try {
    result = await request(parsed.data.linkRef, accessToken);
  } catch (error) {
    return unavailableTelegramLinkMutation(error);
  }
  return mapTelegramLinkMutationResult(result);
}
