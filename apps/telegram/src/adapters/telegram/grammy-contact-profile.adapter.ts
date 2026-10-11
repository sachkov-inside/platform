import {
  AbortController as GrammyAbortController,
  type AbortSignal as GrammyAbortSignal,
} from "abort-controller";
import { Api } from "grammy";
import { telegramContactSchema } from "@inside/contracts/telegram-contact";
import type {
  ContactProfileResult,
  TelegramContactProfile,
} from "../../modules/identity-linking/telegram-contact-profile.js";
import { reportFailure } from "../../shared/failure-diagnostics.js";

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
      const name = [chat.first_name, chat.last_name]
        .filter(Boolean)
        .join(" ")
        .trim();
      const parsed = telegramContactSchema.safeParse({
        accountRef: "projection",
        telegramIdentityRef: "projection",
        status: "available",
        displayName: name === "" ? null : name.slice(0, 160),
        username: chat.username ?? null,
      });
      return parsed.success
        ? {
            kind: "available",
            displayName: parsed.data.displayName,
            username: parsed.data.username,
          }
        : { kind: "unavailable" };
    } catch (error) {
      reportFailure("telegram.contact-profile", error);
      return { kind: "unavailable" };
    } finally {
      signal.removeEventListener("abort", abort);
    }
  }
}
