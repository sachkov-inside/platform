import type { TelegramLinkMutationResult } from "../model/account-telegram-membership";
import { beginTelegramLinkOperation } from "./telegram-link.operation";

export function beginTelegramLink(): Promise<TelegramLinkMutationResult> {
  return beginTelegramLinkOperation.send({});
}
