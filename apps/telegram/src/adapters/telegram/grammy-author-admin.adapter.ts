import { z } from "zod";
import { isTruthy } from "../../shared/truthiness.js";
import type { AuthorInput } from "../../modules/communications/author-input.js";
import { snapshot } from "./grammy-template-intake.adapter.js";
import { nativeMessageSource } from "../../modules/communications/native-message-source.js";

const botProfile = z.object({
  is_bot: z.literal(true),
  username: z.string().regex(/^[A-Za-z0-9_]{5,32}$/u),
});

export function translateAuthorInput(
  botIdentity: string,
  updateId: string,
  payload: unknown,
): AuthorInput | undefined {
  if (!record(payload)) return;
  const callback = record(payload["callback_query"])
    ? payload["callback_query"]
    : undefined;
  const message = callback ? callback["message"] : payload["message"];
  if (!record(message)) return;
  const from = callback ? callback["from"] : message["from"];
  if (
    !record(from) ||
    from["is_bot"] !== false ||
    !Number.isSafeInteger(from["id"]) ||
    Number(from["id"]) <= 0 ||
    !record(message["chat"]) ||
    message["chat"]["type"] !== "private" ||
    message["chat"]["id"] !== from["id"] ||
    isTruthy(message["sender_chat"])
  )
    return;
  let pressed: { callbackData: string; callbackQueryId: string } | undefined;
  if (callback) {
    const { data, id } = callback;
    if (
      typeof data !== "string" ||
      !data.startsWith("author:") ||
      typeof id !== "string"
    )
      return;
    pressed = { callbackData: data, callbackQueryId: id };
  }
  const bot = callback ? botProfile.safeParse(message["from"]) : undefined;
  const source =
    !callback &&
    !(
      typeof message["text"] === "string" &&
      message["text"].trim().startsWith("/")
    )
      ? nativeMessageSource(message)
      : undefined;
  return {
    botIdentity,
    ...(bot?.success === true ? { botUsername: bot.data.username } : {}),
    updateId,
    telegramUserId: String(from["id"]),
    privateChatId: String(message["chat"]["id"]),
    text:
      typeof message["text"] === "string" && !callback
        ? message["text"].trim()
        : "",
    content: callback ? null : snapshot(message),
    ...(source !== undefined ? { nativeSource: source } : {}),
    ...(callback &&
    Number.isSafeInteger(message["message_id"]) &&
    Number(message["message_id"]) > 0
      ? { callbackMessageId: String(message["message_id"]) }
      : {}),
    ...pressed,
  };
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
