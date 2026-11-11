// Limits of Telegram HTML widgets (Bot API 10.4) and the limits the Trainer derives from them.
// Source: https://core.telegram.org/bots/widgets, section "Limits".
// docs/adr/0004-trainer-html-widget.md explains the choices.

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
export const TRAINER_WIDGET_TARGET_HEIGHT_PX = 560;
/** Bubble widths the layout is checked at; 320 is the narrowest phone layout. */
export const TRAINER_WIDGET_CHECKED_WIDTHS_PX = [320, 390, 430] as const;

// Text limits (owner decision of 2026-11-11). A character limit is a coarse bound: what decides
// is the 1 024 bytes of each answer, which the Bank import counts with trainerContextDataBytes
// and trainerQuestionDataBytes, and the screen, which `trainer:widget:fit` measures for every
// card of a Bank file. Measured in Chromium with the built widget and ordinary Russian text: a
// question whose answer fits 1 024 bytes fits 560 px at a 320 px bubble with text of 12 px or
// more, and a context of 500 characters fits its own screen in text of 13 px or more.
// `pnpm --filter @inside/telegram test:widget` repeats the measurement.
// Lengths are characters as trainerTextLength counts them.

/** The situation a long question starts from. It has its own screen before the question. */
export const TRAINER_CONTEXT_MAX_CHARS = 500;
/** Question text. It may be empty only when the question has a context. */
export const TRAINER_QUESTION_MAX_CHARS = 200;
/** A question has 2 to 4 options. */
export const TRAINER_OPTIONS_MIN = 2;
export const TRAINER_OPTIONS_MAX = 4;
/** All option texts of one question together. */
export const TRAINER_OPTIONS_TOTAL_MAX_CHARS = 400;
/**
 * The explanation text shown after the answer, whatever parts the bot composes it from. The
 * bot sends it in parts of one answer each; the widget pages through them.
 */
export const TRAINER_EXPLANATION_MAX_CHARS = 700;

// What a widget sent before the limits above can show: it has no context screen and asks for
// no further part of an explanation, and it was measured at these lengths with the widest
// letters. The bot gives it only questions inside these limits.
export const TRAINER_FIRST_WIDGET_QUESTION_MAX_CHARS = 160;
export const TRAINER_FIRST_WIDGET_OPTIONS_TOTAL_MAX_CHARS = 240;
export const TRAINER_FIRST_WIDGET_EXPLANATION_MAX_CHARS = 200;
/** Topic name; it is shown above a question, in the topic list and in Progress. */
export const TRAINER_TOPIC_NAME_MAX_CHARS = 40;
/** Topics in the Bank, shown in bounded pages. */
export const TRAINER_TOPICS_MAX = 64;
/** Topic rows per page in topic choice and Progress. */
export const TRAINER_TOPICS_PAGE_SIZE = 3;
/** The ready line under an explanation (the share of correct answers to the Daily question). */
export const TRAINER_STAT_LINE_MAX_CHARS = 40;
/** Rating rows on one screen: the first 7 and the viewer's own. */
export const TRAINER_RATING_ROWS_MAX = 8;
/** A Telegram name in the Rating; the bot cuts longer names before sending. */
export const TRAINER_RATING_NAME_MAX_CHARS = 24;
/** Title and comment of the round result. */
export const TRAINER_RESULT_TITLE_MAX_CHARS = 40;
export const TRAINER_RESULT_COMMENT_MAX_CHARS = 60;
