import type { TelegramLinkMutationResult } from "../model/account-telegram-membership";
import { confirmTelegramLinkOperation } from "./telegram-link.operation";

export function confirmTelegramLink(
  linkRef: string,
): Promise<TelegramLinkMutationResult> {
  return confirmTelegramLinkOperation.send({ linkRef });
}
