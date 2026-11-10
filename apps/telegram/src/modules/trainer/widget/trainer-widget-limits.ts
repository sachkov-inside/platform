// Limits of Telegram HTML widgets (Bot API 10.4) and the limits the Trainer derives from them.
// Source: https://core.telegram.org/bots/widgets, section "Limits".
// docs/adr/0004-trainer-html-widget.md explains the choices.

/** `html` of sendWidget: bytes of UTF-8. */
export const TELEGRAM_WIDGET_HTML_MAX_BYTES = 32_768;
/** `html` after the server compresses it with zlib at level 9. */
export const TELEGRAM_WIDGET_COMPRESSED_MAX_BYTES = 4_096;
/**
 * The build stops here. Telegram counts as Python's zlib does, and the guide warns that the
 * zlib of Node.js "can be a few dozen bytes off either way", so the build keeps that distance.
 */
export const TRAINER_WIDGET_COMPRESSED_BUDGET_BYTES =
  TELEGRAM_WIDGET_COMPRESSED_MAX_BYTES - 64;

/** `data` of a request from the widget (`widget_query.data`): bytes of UTF-8. */
export const TELEGRAM_WIDGET_REQUEST_MAX_BYTES = 64;
/** `data` of answerWidgetQuery, and `chat_data` of sendWidget: bytes of UTF-8. */
export const TELEGRAM_WIDGET_DATA_MAX_BYTES = 1_024;
/** The bot must call answerWidgetQuery within this time; the query id expires with it. */
export const TELEGRAM_WIDGET_ANSWER_TIMEOUT_SECONDS = 15;

/** The bubble clips a widget at this height; nothing scrolls inside it. */
export const TELEGRAM_WIDGET_MAX_HEIGHT_PX = 600;
/** The guide's advice for a 320 px wide bubble, and the Trainer's target for every screen. */
export const TRAINER_WIDGET_TARGET_HEIGHT_PX = 560;
/** Bubble widths the layout is checked at; 320 is the narrowest phone layout. */
export const TRAINER_WIDGET_CHECKED_WIDTHS_PX = [320, 390, 430] as const;

// Text limits. Measured in Chromium with the built widget at a 320 px bubble and the default
// 15 px text: at these lengths the question screen (four options and «Ответить») and the
// explanation screen (all four options kept, the statistics line) are not taller than 560 px.
// `pnpm --filter @inside/telegram test:widget` repeats the measurement.
// Lengths are characters as trainerTextLength counts them. The Bank import also checks bytes
// with trainerQuestionDataBytes and trainerExplanationDataBytes: a length limit alone does
// not keep three-byte signs inside 1 024 bytes.

/** Question text. */
export const TRAINER_QUESTION_MAX_CHARS = 160;
/** A question has 2 to 4 options. */
export const TRAINER_OPTIONS_MIN = 2;
export const TRAINER_OPTIONS_MAX = 4;
/** All option texts of one question together. */
export const TRAINER_OPTIONS_TOTAL_MAX_CHARS = 240;
/** The explanation text shown after the answer, whatever parts the bot composes it from. */
export const TRAINER_EXPLANATION_MAX_CHARS = 200;
/** Topic name; it is shown above a question, in the topic list and in Progress. */
export const TRAINER_TOPIC_NAME_MAX_CHARS = 40;
/** Topics in the Bank: the topic list and Progress show all of them on one screen. */
export const TRAINER_TOPICS_MAX = 9;
/** The ready line under an explanation (the share of correct answers to the Daily question). */
export const TRAINER_STAT_LINE_MAX_CHARS = 40;
/** Rating rows on one screen: the first 7 and the viewer's own. */
export const TRAINER_RATING_ROWS_MAX = 8;
/** A Telegram name in the Rating; the bot cuts longer names before sending. */
export const TRAINER_RATING_NAME_MAX_CHARS = 24;
/** Title and comment of the round result. */
export const TRAINER_RESULT_TITLE_MAX_CHARS = 40;
export const TRAINER_RESULT_COMMENT_MAX_CHARS = 60;
