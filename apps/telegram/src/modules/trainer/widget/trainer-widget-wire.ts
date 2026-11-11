import { TRAINER_CODE_PATTERN } from "../trainer-identifiers.js";
import {
  TELEGRAM_WIDGET_DATA_MAX_BYTES,
  TELEGRAM_WIDGET_REQUEST_MAX_BYTES,
  TRAINER_STAT_LINE_MAX_CHARS,
} from "./trainer-widget-limits.js";

// The wire format between the bot and the Trainer widget (widget.js draws it).
//
// Bot to widget: `chat_data` of sendWidget (always a home screen) and `data` of
// answerWidgetQuery. Each is a JSON array whose first item names the screen. Arrays instead of
// objects, one-letter screen names and bit masks keep a question inside 1 024 bytes.
// Widget to bot: `widget_query.data`, a short ASCII text of at most 64 bytes.
//
// The widget's code and data are public. A question never carries which option is correct;
// the explanation carries it only after the bot has recorded the answer.

/** Bit `i` is set for option `i` (0 is «А»). 0 as a picked mask means «Не знаю». */
export type OptionMask = number;
/** One digit per answered step of the round: "1" correct, "0" wrong. */
export type RoundMarks = string;
type Flag = 0 | 1;
/** 0 no reaction, 1 like, 2 dislike. */
export type TrainerReaction = 0 | 1 | 2;

/** Home. `chat_data` of the message holds this shape. */
export type TrainerHomeData = readonly [
  screen: "h",
  streakDays: number,
  answeredToday: number,
  dailyGoal: number,
  dailyQuestionDone: Flag,
];
/** Topic choice. `code` returns to the bot in the request `t<code>`. */
export type TrainerTopicsData = readonly [
  screen: "t",
  topics: readonly (readonly [
    code: string,
    name: string,
    answered: number,
    total: number,
  ])[],
  page?: number,
  pages?: number,
];
/**
 * A question. `total` is the number of steps in the round. `daily` draws «Вопрос дня» instead of
 * the steps. `reviewMask` is present only when the person has already answered (a repeated
 * view of the Daily question): the widget shows the picked options and «Показать разбор».
 */
export type TrainerQuestionData = readonly [
  screen: "q",
  issueId: string,
  topic: string,
  text: string,
  options: readonly string[],
  severalCorrect: Flag,
  marks: RoundMarks,
  total: number,
  reviewMask?: OptionMask | null,
  daily?: Flag,
];
/** 0 wrong, 1 correct without a point, 2 correct with a point, 3 «Не знаю». */
export type TrainerVerdict = 0 | 1 | 2 | 3;
/**
 * The explanation of the question the widget is showing: it reuses that question's option
 * texts and keeps only the correct and the picked ones. `stat` is a ready line under the
 * explanation (the share of correct answers to the Daily question) or 0.
 */
export type TrainerExplanationData = readonly [
  screen: "e",
  verdict: TrainerVerdict,
  correctMask: OptionMask,
  pickedMask: OptionMask,
  explanation: string,
  marks: RoundMarks,
  total: number,
  stat: string | 0,
  reaction?: TrainerReaction,
];
/** Round result. `weekPlace` 0: the Rating of the week does not list the person. */
export type TrainerResultData = readonly [
  screen: "r",
  title: string,
  correct: number,
  total: number,
  comment: string,
  points: number,
  streakDays: number,
  weekPlace: number,
  topicRound: Flag,
];
/** Progress. `correctPercent` -1 means the topic is not started. */
export type TrainerProgressData = readonly [
  screen: "p",
  points: number,
  streakDays: number,
  answered: number,
  topics: readonly (readonly [
    name: string,
    answered: number,
    total: number,
    correctPercent: number,
  ])[],
  page?: number,
  pages?: number,
];
/**
 * Rating: the first 7 rows and the viewer's own row. the third slot is retained for old widgets. New responses always send 1;
 * the current widget ignores this retired preference.
 */
export type TrainerRatingData = readonly [
  screen: "l",
  allTime: Flag,
  legacyShown: Flag | 2,
  rows: readonly (readonly [
    place: number,
    name: string,
    points: number,
    isViewer: Flag,
  ])[],
];
/** The bot could not serve the request; `text` replaces the widget's own wording. */
export type TrainerFailureData = readonly [screen: "x", text?: string];

export type TrainerWidgetData =
  | TrainerHomeData
  | TrainerTopicsData
  | TrainerQuestionData
  | TrainerExplanationData
  | TrainerResultData
  | TrainerProgressData
  | TrainerRatingData
  | TrainerFailureData
  | readonly [screen: "u", issueId: string, reaction: TrainerReaction]
  | readonly [screen: "i", text: string];

export const utf8ByteLength = (text: string): number =>
  Buffer.byteLength(text, "utf8");

/** Length in characters as the text limits count it: code points of the composed form. */
export const trainerTextLength = (text: string): number =>
  Array.from(text.normalize("NFC")).length;

/** JSON text for `chat_data` or for the answer to a widget query. */
export function encodeTrainerWidgetData(data: TrainerWidgetData): string {
  const text = JSON.stringify(data);
  const bytes = utf8ByteLength(text);
  if (bytes > TELEGRAM_WIDGET_DATA_MAX_BYTES)
    throw new RangeError(
      `Trainer widget data "${data[0]}" takes ${String(bytes)} bytes; Telegram accepts ${String(TELEGRAM_WIDGET_DATA_MAX_BYTES)}.`,
    );
  return text;
}

// The longest values the bot may put around the texts of a question.
const LONGEST_ISSUE_ID = "z".repeat(16);
const LONGEST_MARKS = "1".repeat(10);
const LONGEST_ROUND = 10;
const EVERY_OPTION: OptionMask = 15;

/** Bytes of the largest answer that carries this question, whatever round it is asked in. */
export function trainerQuestionDataBytes(question: {
  readonly topic: string;
  readonly text: string;
  readonly options: readonly string[];
}): number {
  const data: TrainerQuestionData = [
    "q",
    LONGEST_ISSUE_ID,
    question.topic,
    question.text,
    question.options,
    1,
    LONGEST_MARKS,
    LONGEST_ROUND,
    EVERY_OPTION,
    1,
  ];
  return utf8ByteLength(JSON.stringify(data));
}

/** Bytes of the largest answer that carries this explanation. */
export function trainerExplanationDataBytes(question: {
  readonly explanation: string;
}): number {
  const data: TrainerExplanationData = [
    "e",
    3,
    EVERY_OPTION,
    EVERY_OPTION,
    question.explanation,
    LONGEST_MARKS,
    LONGEST_ROUND,
    "ж".repeat(TRAINER_STAT_LINE_MAX_CHARS),
    2,
  ];
  return utf8ByteLength(JSON.stringify(data));
}

export type TrainerWidgetRequest =
  | {
      readonly kind: "reaction";
      readonly issueId: string;
      readonly reaction: TrainerReaction;
    }
  | { readonly kind: "home" }
  | { readonly kind: "start_check" }
  | { readonly kind: "start_daily" }
  | { readonly kind: "topics"; readonly page?: number }
  | { readonly kind: "start_topic"; readonly topicCode: string }
  | { readonly kind: "progress"; readonly page?: number }
  | { readonly kind: "rating"; readonly allTime: boolean }
  | { readonly kind: "next"; readonly issueId?: string }
  | {
      readonly kind: "answer";
      readonly issueId: string;
      readonly optionMask: OptionMask;
    };

const simpleRequests: Readonly<Record<string, TrainerWidgetRequest>> = {
  h: { kind: "home" },
  q: { kind: "start_check" },
  d: { kind: "start_daily" },
  t: { kind: "topics" },
  p: { kind: "progress" },
  n: { kind: "next" },
  l0: { kind: "rating", allTime: false },
  l1: { kind: "rating", allTime: true },
};
/** Issue ids and topic codes: 1-16 lowercase Latin letters and digits. */
const answerRequest = new RegExp(`^a(${TRAINER_CODE_PATTERN}):([0-9]{1,2})$`);
const reactionRequest = new RegExp(`^f(${TRAINER_CODE_PATTERN}):([012])$`);
const topicRequest = new RegExp(`^t(${TRAINER_CODE_PATTERN})$`);
const nextRequest = new RegExp(`^n(${TRAINER_CODE_PATTERN})$`);
const shownRequest = /^v([01])([01])$/;

/**
 * Reads `widget_query.data`. The text comes from a public widget: an unknown or malformed
 * request yields `undefined`, and a known one still has to be checked against the bot's state.
 */
export function parseTrainerWidgetRequest(
  data: string,
): TrainerWidgetRequest | undefined {
  if (utf8ByteLength(data) > TELEGRAM_WIDGET_REQUEST_MAX_BYTES)
    return undefined;
  if (Object.hasOwn(simpleRequests, data)) return simpleRequests[data];

  const page = /^([pt]):([0-9]{1,3})$/.exec(data);
  if (page)
    return {
      kind: page[1] === "p" ? "progress" : "topics",
      page: Number(page[2]),
    };
  const next = nextRequest.exec(data);
  if (next?.[1] !== undefined) return { kind: "next", issueId: next[1] };
  const answer = answerRequest.exec(data);
  if (answer?.[1] !== undefined && answer[2] !== undefined) {
    const optionMask = Number(answer[2]);
    return optionMask <= EVERY_OPTION
      ? { kind: "answer", issueId: answer[1], optionMask }
      : undefined;
  }
  const topic = topicRequest.exec(data);
  if (topic?.[1] !== undefined)
    return { kind: "start_topic", topicCode: topic[1] };
  const shown = shownRequest.exec(data);
  const reaction = reactionRequest.exec(data);
  if (reaction?.[1] !== undefined)
    return {
      kind: "reaction",
      issueId: reaction[1],
      reaction: reaction[2] === "1" ? 1 : reaction[2] === "2" ? 2 : 0,
    };
  if (shown)
    return {
      // Old widgets may send their retired switch; it now only opens the requested table.
      kind: "rating",
      allTime: shown[2] === "1",
    };
  return undefined;
}
