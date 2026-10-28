import {
  AbortController as GrammyAbortController,
  type AbortSignal as GrammyAbortSignal,
} from "abort-controller";
import { Api } from "grammy";
import type {
  ContactProfileResult,
  TelegramContactProfile,
} from "../../modules/identity-linking/telegram-contact-profile.js";
import { reportFailure } from "../../shared/failure-diagnostics.js";
import { telegramUserProfile } from "./telegram-user-profile.js";

interface TelegramApi {
  getChat(
    chatId: number,
    signal?: GrammyAbortSignal,
  ): Promise<{
    id: number;
    type: string;
    first_name?: string | undefined;
    last_name?: string | undefined;
    username?: string | undefined;
  }>;
}
export class GrammyContactProfileAdapter implements TelegramContactProfile {
  private readonly api: TelegramApi;
  constructor(token: string, api?: TelegramApi) {
    this.api = api ?? new Api(token, { timeoutSeconds: 4 });
  }
  async read(
    telegramUserId: string,
    signal: AbortSignal,
  ): Promise<ContactProfileResult> {
    const id = Number(telegramUserId);
    if (!Number.isSafeInteger(id) || id <= 0 || signal.aborted)
      return { kind: "unavailable" };
    const controller = new GrammyAbortController();
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    try {
      const chat = await this.api.getChat(id, controller.signal);
      if (chat.type !== "private" || chat.id !== id)
        return { kind: "unavailable" };
      const profile = telegramUserProfile(chat);
      return profile
        ? { kind: "available", ...profile }
        : { kind: "unavailable" };
    } catch (error) {
      reportFailure("telegram.contact-profile", error);
      return { kind: "unavailable" };
    } finally {
      signal.removeEventListener("abort", abort);
    }
  }
}
