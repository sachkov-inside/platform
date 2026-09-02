import "server-only";

import { handleAuthenticatedMutation } from "@/shared/auth/index.server";

import { executeBeginTelegramLink } from "./begin-telegram-link";
import { executeConfirmTelegramLink } from "./confirm-telegram-link";

export function handleBeginTelegramLinkRequest(
  request: Request,
): Promise<Response> {
  return handleAuthenticatedMutation(request, executeBeginTelegramLink);
}

export function handleConfirmTelegramLinkRequest(
  request: Request,
): Promise<Response> {
  return handleAuthenticatedMutation(request, executeConfirmTelegramLink);
}
