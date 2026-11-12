// Limits of Telegram HTML widgets (Bot API 10.4), the same for every widget the bot sends.
// Source: https://core.telegram.org/bots/widgets, section "Limits".
// apps/telegram/docs/adr/0004-trainer-html-widget.md explains the choices.

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
