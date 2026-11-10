import { isTruthy } from "../../shared/truthiness.js";
import { Api, GrammyError } from "grammy";

import type {
  TelegramButton,
  TelegramDeliveryResult,
  TelegramMessages,
  TelegramMessageEdit,
  TelegramTextMessage,
  TelegramWidgetAnswer,
  TelegramWidgetMessage,
} from "../../modules/outbound/telegram-messages.js";
import { reportFailure } from "../../shared/failure-diagnostics.js";
import {
  telegramWidgetApi,
  type TelegramWidgetApi,
} from "./telegram-widget-api.js";

type WidgetCalls = Pick<TelegramWidgetApi, "sendWidget" | "answerWidgetQuery">;

// Telegram refuses an answer 15 seconds after the press. A call that has not returned by
// then cannot succeed, and the update lane of that person should not wait for it longer.
const WIDGET_ANSWER_TIMEOUT_SECONDS = 5;

export class GrammyMessagesAdapter implements TelegramMessages {
  private readonly api: TelegramApi;
  private readonly widgets: WidgetCalls;

  constructor(token: string, api?: TelegramApi, widgets?: WidgetCalls) {
    const client = new Api(token, { timeoutSeconds: 10 });
    this.api = api ?? client;
    const sending = telegramWidgetApi(client);
    const answering = telegramWidgetApi(
      new Api(token, { timeoutSeconds: WIDGET_ANSWER_TIMEOUT_SECONDS }),
    );
    this.widgets = widgets ?? {
      sendWidget: (parameters) => sending.sendWidget(parameters),
      answerWidgetQuery: (parameters) =>
        answering.answerWidgetQuery(parameters),
    };
  }

  async sendWidget(
    message: TelegramWidgetMessage,
  ): Promise<TelegramDeliveryResult> {
    const chatId = toSafeTelegramNumber(message.chatId);
    try {
      const sent = await this.widgets.sendWidget({
        chat_id: chatId,
        html: message.html,
        chat_data: message.chatData,
        ...(message.caption === undefined ? {} : { caption: message.caption }),
        allow_queries: true,
        height: message.height,
      });
      return { kind: "delivered", providerMessageId: String(sent.message_id) };
    } catch (error) {
      return deliveryFailure(error);
    }
  }

  async answerWidgetQuery(answer: TelegramWidgetAnswer): Promise<void> {
    try {
      await this.widgets.answerWidgetQuery({
        widget_query_id: answer.queryId,
        data: answer.data,
      });
    } catch (error) {
      // The answer is not repeatable: the widget shows its own no-answer state and the
      // person presses again. The report keeps a refused answer visible to the operator.
      reportFailure("telegram.widget-answer", error);
    }
  }

  async sendText(
    message: TelegramTextMessage,
  ): Promise<TelegramDeliveryResult> {
    const chatId = toSafeTelegramNumber(message.chatId);
    try {
      const sent = message.buttons
        ? await this.api.sendMessage(chatId, message.text, {
            reply_markup: {
              inline_keyboard: inlineKeyboard(message.buttons),
            },
          })
        : await this.api.sendMessage(chatId, message.text);
      return {
        kind: "delivered",
        providerMessageId: String(sent.message_id),
      };
    } catch (error) {
      return deliveryFailure(error);
    }
  }

  async editText(
    message: TelegramMessageEdit,
  ): Promise<TelegramDeliveryResult> {
    try {
      await this.api.editMessageText(
        toSafeTelegramNumber(message.chatId),
        toSafeTelegramNumber(message.messageId),
        message.text,
        {
          reply_markup: { inline_keyboard: inlineKeyboard(message.buttons) },
        },
      );
      return { kind: "delivered", providerMessageId: message.messageId };
    } catch (error) {
      // Repeating the same edit after an ambiguous response is already the intended result.
      if (
        error instanceof GrammyError &&
        error.error_code === 400 &&
        error.description.startsWith("Bad Request: message is not modified")
      ) {
        return { kind: "delivered", providerMessageId: message.messageId };
      }
      return deliveryFailure(error);
    }
  }
}

function deliveryFailure(error: unknown): TelegramDeliveryResult {
  if (error instanceof GrammyError) {
    if (error.error_code === 429 || error.error_code >= 500) {
      const retryAfterSeconds = positiveInteger(error.parameters.retry_after);
      return {
        kind: "api_retryable",
        providerErrorCode: error.error_code,
        ...(isTruthy(retryAfterSeconds) ? { retryAfterSeconds } : {}),
      };
    }
    return { kind: "api_rejected", providerErrorCode: error.error_code };
  }
  reportFailure("telegram.messages", error);
  return { kind: "transport_unknown" };
}

type TelegramInlineKeyboard = ({ text: string } & (
  { callback_data: string } | { url: string }
))[][];

function inlineKeyboard(
  buttons: readonly TelegramButton[] = [],
): TelegramInlineKeyboard {
  return buttons.map((button) => [
    {
      text: button.text,
      ...(button.callbackData !== undefined
        ? { callback_data: button.callbackData }
        : { url: button.url }),
    },
  ]);
}

interface TelegramApi {
  editMessageText(
    chatId: number,
    messageId: number,
    text: string,
    options: { reply_markup: { inline_keyboard: TelegramInlineKeyboard } },
  ): Promise<true | { message_id: number }>;
  sendMessage(
    chatId: number,
    text: string,
    options?: {
      reply_markup: {
        inline_keyboard: TelegramInlineKeyboard;
      };
    },
  ): Promise<{ message_id: number }>;
}

export class DisabledMessagesAdapter implements TelegramMessages {
  editText(): Promise<TelegramDeliveryResult> {
    return Promise.reject(new Error("External Telegram delivery is disabled"));
  }
  sendText(): Promise<TelegramDeliveryResult> {
    return Promise.reject(new Error("External Telegram delivery is disabled"));
  }
  sendWidget(): Promise<TelegramDeliveryResult> {
    return Promise.reject(new Error("External Telegram delivery is disabled"));
  }
  answerWidgetQuery(): Promise<void> {
    return Promise.resolve();
  }
}

function toSafeTelegramNumber(value: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) {
    throw new Error(
      "Persisted Telegram chat ID is outside the safe JSON range",
    );
  }
  return number;
}

function positiveInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    return undefined;
  }
  return value;
}
