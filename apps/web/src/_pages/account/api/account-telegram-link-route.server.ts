import "server-only";

import {
  beginTelegramLinkOperation,
  confirmTelegramLinkOperation,
} from "@/features/account-access.operations";
import { handleMutationOperation } from "@/shared/auth/index.server";

import { executeBeginTelegramLink } from "./begin-telegram-link";
import {
  executeConfirmTelegramLink,
  invalidTelegramLinkInput,
} from "./confirm-telegram-link";

export function handleBeginTelegramLinkRequest(
  request: Request,
): Promise<Response> {
  return handleMutationOperation(request, beginTelegramLinkOperation, {
    execute: (_input, accessToken) => executeBeginTelegramLink(accessToken),
    invalidInput: invalidTelegramLinkInput,
  });
}

export function handleConfirmTelegramLinkRequest(
  request: Request,
): Promise<Response> {
  return handleMutationOperation(request, confirmTelegramLinkOperation, {
    execute: (input, accessToken) =>
      executeConfirmTelegramLink(input, accessToken),
    invalidInput: invalidTelegramLinkInput,
  });
}
