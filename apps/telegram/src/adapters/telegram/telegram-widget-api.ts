import type { Api } from "grammy";
import { z } from "zod";

// HTML widgets arrived in Bot API 10.4 (9 November 2026). grammY 1.46.0, the newest release,
// implements Bot API 10.3: it has no sendWidget or answerWidgetQuery and its Update type has no
// widget_query. `api.raw` forwards any method name to Telegram, so the widget methods are called
// through it with the parameter types below, and failures still arrive as GrammyError.
// Delete this file when a grammY release brings the methods.
// Reference: https://core.telegram.org/bots/api#sendwidget

export interface SendWidgetParameters {
  readonly chat_id: number;
  /** 1-32768 bytes, and at most 4096 bytes after zlib level 9. */
  readonly html: string;
  /** State of this message, 0-1024 bytes; the widget reads it as `chatData`. */
  readonly chat_data?: string;
  /** State shown wherever the widget is shown, 0-1024 bytes. */
  readonly public_data?: string;
  /** 0-1024 characters. Shown below the widget, and instead of it by apps without widgets. */
  readonly caption?: string;
  readonly show_caption_above_media?: boolean;
  /** Without it Telegram refuses every request from the widget. */
  readonly allow_queries?: boolean;
  readonly is_shared?: boolean;
  readonly width?: number;
  readonly height?: number;
  readonly disable_notification?: boolean;
  readonly protect_content?: boolean;
}

export interface AnswerWidgetQueryParameters {
  readonly widget_query_id: string;
  /** 0-1024 bytes; only the widget that asked receives it. */
  readonly data?: string;
}

export interface EditMessageWidgetDataParameters {
  readonly chat_id: number;
  readonly message_id: number;
  /** An empty text clears the state; an omitted field keeps it. */
  readonly chat_data?: string;
  readonly public_data?: string;
}

/** `widget_query` of an Update for a widget the bot sent to a chat. */
export interface TelegramWidgetQuery {
  readonly id: string;
  readonly from: { readonly id: number; readonly first_name: string };
  readonly chat?: { readonly id: number; readonly type: string };
  readonly message_id?: number;
  readonly chat_instance: string;
  readonly type: { readonly type: string };
  /** 1-64 bytes, written by the widget: untrusted input. */
  readonly data: string;
}

export interface TelegramWidgetApi {
  sendWidget(
    parameters: SendWidgetParameters,
  ): Promise<{ readonly message_id: number }>;
  answerWidgetQuery(parameters: AnswerWidgetQueryParameters): Promise<true>;
  editMessageWidgetData(
    parameters: EditMessageWidgetDataParameters,
  ): Promise<true>;
}

const sentMessage = z.object({ message_id: z.number().int() });

export function telegramWidgetApi(api: Pick<Api, "raw">): TelegramWidgetApi {
  const call = async (method: string, parameters: object): Promise<unknown> => {
    // `raw` is a Proxy: every property is a function that calls the Bot API method of that name.
    const invoke: unknown = Reflect.get(api.raw, method);
    if (typeof invoke !== "function")
      throw new TypeError(`grammY raw API has no callable ${method}`);
    const result: unknown = await Reflect.apply(invoke, api.raw, [parameters]);
    return result;
  };
  const acknowledged = async (
    method: string,
    parameters: object,
  ): Promise<true> => {
    if ((await call(method, parameters)) !== true)
      throw new TypeError(`Telegram ${method} did not return True`);
    return true;
  };
  return {
    async sendWidget(parameters) {
      const message = sentMessage.parse(await call("sendWidget", parameters));
      return { message_id: message.message_id };
    },
    answerWidgetQuery: (parameters) =>
      acknowledged("answerWidgetQuery", parameters),
    editMessageWidgetData: (parameters) =>
      acknowledged("editMessageWidgetData", parameters),
  };
}
