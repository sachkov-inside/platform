import { TELEGRAM_WIDGET_DATA_MAX_BYTES } from "../../outbound/telegram-widget-limits.js";

// The wire format between the bot and the ИИ-модели widget (widget.js draws it).
//
// Bot to widget: `chat_data` of sendWidget and `data` of answerWidgetQuery. Each is a JSON array
// whose first item names the screen, at most 1 024 bytes of UTF-8.
// Widget to bot: `widget_query.data`, a short ASCII text of at most 64 bytes that starts with
// the mark "3" (AI_MODELS_WIDGET_MARK); the update adapter routes it here by that mark.
// The widget's code and data are public.

/**
 * `chat_data` of a new message: the first page of «Мощные» without its rows. The widget asks
 * the bot for that page with the request `3lp0`.
 */
export type AiModelsFirstPageData = readonly [
  screen: "l",
  filter: "p",
  page: 0,
];
/**
 * The bot refused, or the widget sent something it cannot read. The widget shows the text, or
 * its own when there is none, with a button that repeats the request.
 */
export type AiModelsFailureData =
  readonly [screen: "x"] | readonly [screen: "x", text: string];

export type AiModelsWidgetData = AiModelsFirstPageData | AiModelsFailureData;

export const AI_MODELS_FIRST_PAGE: AiModelsFirstPageData = ["l", "p", 0];

export function encodeAiModelsWidgetData(data: AiModelsWidgetData): string {
  const text = JSON.stringify(data);
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > TELEGRAM_WIDGET_DATA_MAX_BYTES)
    throw new RangeError(
      `ИИ-модели widget data "${data[0]}" takes ${String(bytes)} bytes; Telegram accepts ${String(TELEGRAM_WIDGET_DATA_MAX_BYTES)}.`,
    );
  return text;
}
