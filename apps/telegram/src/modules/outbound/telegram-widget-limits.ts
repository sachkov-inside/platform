// Limits of Telegram HTML widgets (Bot API 10.4), the same for every widget the bot sends.
// Source: https://core.telegram.org/bots/widgets, section "Limits".
// apps/telegram/docs/adr/0004-trainer-html-widget.md explains the choices.

/** How every byte limit below counts a text: bytes of UTF-8. */
export const utf8ByteLength = (text: string): number =>
  Buffer.byteLength(text, "utf8");

/** `html` of sendWidget: bytes of UTF-8. */
export const TELEGRAM_WIDGET_HTML_MAX_BYTES = 32_768;
/**
 * `html` after the server compresses it with zlib at level 9. The build stops at this number
 * as the zlib of Node.js counts. Telegram counts as Python's zlib does, and in the builds that
 * ADR 0004 records Node.js counted 70 to 80 bytes more: a widget inside the limit by the
 * count of Node.js is inside it by the server's count with that distance to spare.
 */
export const TELEGRAM_WIDGET_COMPRESSED_MAX_BYTES = 4_096;

/** `data` of a request from the widget (`widget_query.data`): bytes of UTF-8. */
export const TELEGRAM_WIDGET_REQUEST_MAX_BYTES = 64;
/** `data` of answerWidgetQuery, and `chat_data` of sendWidget: bytes of UTF-8. */
export const TELEGRAM_WIDGET_DATA_MAX_BYTES = 1_024;

/** The bubble clips a widget at this height; nothing scrolls inside it. */
export const TELEGRAM_WIDGET_MAX_HEIGHT_PX = 600;
/** The guide's target ceiling for every screen in a 320 px wide bubble. */
export const TELEGRAM_WIDGET_TARGET_HEIGHT_PX = 560;

// How the bot's checks draw every widget (ADR 0004). The widget.js of each widget writes 560 and
// 11 as bare numbers of its own; the fit commands and the browser checks hold its screens to the
// numbers here.

/** The narrowest bubble and a common phone: the fit commands draw every screen at both. */
export const TELEGRAM_WIDGET_FIT_WIDTHS_PX = [320, 390] as const;
/** The smallest text a widget may shrink to when a screen would be taller than the target. */
export const TELEGRAM_WIDGET_SMALLEST_FONT_PX = 11;
/**
 * The band of the message time over the bottom of a widget without a caption: the tallest one
 * the layout is checked at.
 */
export const TELEGRAM_WIDGET_TIME_BAND_PX = 32;

/** The failure text of every widget for a press over the per-user request limit. */
export const TELEGRAM_WIDGET_TOO_OFTEN_TEXT =
  "Слишком часто. Повторите через несколько секунд.";
