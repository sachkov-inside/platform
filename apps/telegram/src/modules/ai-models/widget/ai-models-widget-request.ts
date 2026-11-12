import {
  TELEGRAM_WIDGET_REQUEST_MAX_BYTES,
  utf8ByteLength,
} from "../../outbound/telegram-widget-limits.js";
import { AI_MODELS_WIDGET_MARK } from "../ai-models-requests.js";

// The requests of the ИИ-модели widget: `widget_query.data`, a short ASCII text of at most
// 64 bytes that starts with the mark "3" (AI_MODELS_WIDGET_MARK); the update adapter routes it
// to the ИИ-модели module by that mark. After the mark comes one request:
// - `l<filter><page>` a page of the list, the page counting from 0, such as `lp0`; `-1` and pages
//   past the end come from the closed arrows of messages sent before 12.11.2026, which Telegram
//   clients still fire, and get the nearest page;
// - `m<code>` the tab «Главное» of a model card, `s<code>` its tab «Подписки»;
// - `a` «О данных».
// The widget's code is public, so the bot reads every request as untrusted text.

/** The filter of the list: p «Мощные», f «⭐ Мой выбор», v «Цена/качество», c «Дёшево». */
export type AiModelsFilter = "p" | "f" | "v" | "c";

/** The filters in the order of their buttons. */
export const AI_MODELS_FILTERS: readonly AiModelsFilter[] = [
  "p",
  "f",
  "v",
  "c",
];

/**
 * Codes of services, plans, models and favorite groups in the Справочник; the requests for a
 * card carry a model code. The database checks stored model codes against this same pattern.
 */
export const AI_MODELS_CODE_PATTERN = "[a-z0-9][a-z0-9-]{0,15}";

export type AiModelsWidgetRequest =
  | {
      readonly kind: "list";
      readonly filter: AiModelsFilter;
      readonly page: number;
    }
  /** Tab «Главное» of a card. */
  | { readonly kind: "card"; readonly model: string }
  /** Tab «Подписки» of a card. */
  | { readonly kind: "subscriptions"; readonly model: string }
  | { readonly kind: "about" };

const listRequest = /^l([pfvc])(-1|[0-9]{1,2})$/;
const cardRequest = new RegExp(`^([ms])(${AI_MODELS_CODE_PATTERN})$`);

/**
 * Reads `widget_query.data`, mark included. The text comes from a public widget: an unknown or
 * malformed request yields `undefined`, and a known one still has to match the Справочник.
 */
export function parseAiModelsWidgetRequest(
  marked: string,
): AiModelsWidgetRequest | undefined {
  if (
    !marked.startsWith(AI_MODELS_WIDGET_MARK) ||
    utf8ByteLength(marked) > TELEGRAM_WIDGET_REQUEST_MAX_BYTES
  )
    return undefined;
  const data = marked.slice(AI_MODELS_WIDGET_MARK.length);
  if (data === "a") return { kind: "about" };
  const list = listRequest.exec(data);
  const filter = AI_MODELS_FILTERS.find((known) => known === list?.[1]);
  if (filter !== undefined)
    return { kind: "list", filter, page: Number(list?.[2]) };
  const card = cardRequest.exec(data);
  if (card?.[2] !== undefined)
    return {
      kind: card[1] === "m" ? "card" : "subscriptions",
      model: card[2],
    };
  return undefined;
}

/** The text the widget sends for the request, mark included. */
export function formatAiModelsWidgetRequest(
  request: AiModelsWidgetRequest,
): string {
  const data = (() => {
    switch (request.kind) {
      case "list":
        return `l${request.filter}${String(request.page)}`;
      case "card":
        return `m${request.model}`;
      case "subscriptions":
        return `s${request.model}`;
      case "about":
        return "a";
    }
  })();
  return AI_MODELS_WIDGET_MARK + data;
}
