import { describe, expect, it } from "vitest";

import {
  TRAINER_EXPLANATION_MAX_CHARS,
  TRAINER_OPTIONS_MAX,
  TRAINER_OPTIONS_TOTAL_MAX_CHARS,
  TRAINER_QUESTION_MAX_CHARS,
  TRAINER_RATING_NAME_MAX_CHARS,
  TRAINER_RATING_ROWS_MAX,
  TRAINER_TOPIC_NAME_MAX_CHARS,
  TRAINER_TOPICS_MAX,
} from "../../src/modules/trainer/widget/trainer-widget-limits.js";
import {
  encodeTrainerWidgetData,
  parseTrainerWidgetRequest,
  trainerExplanationDataBytes,
  trainerQuestionDataBytes,
  trainerTextLength,
} from "../../src/modules/trainer/widget/trainer-widget-wire.js";

// Synthetic filler only: one Cyrillic letter is 2 bytes of UTF-8, the worst ordinary case.
const cyrillic = (length: number): string => "ж".repeat(length);

describe("trainer widget wire format", () => {
  it("fixes the text limits the Bank import applies", () => {
    expect({
      question: TRAINER_QUESTION_MAX_CHARS,
      optionsTotal: TRAINER_OPTIONS_TOTAL_MAX_CHARS,
      options: TRAINER_OPTIONS_MAX,
      explanation: TRAINER_EXPLANATION_MAX_CHARS,
      topicName: TRAINER_TOPIC_NAME_MAX_CHARS,
      topics: TRAINER_TOPICS_MAX,
    }).toEqual({
      question: 160,
      optionsTotal: 240,
      options: 4,
      explanation: 200,
      topicName: 40,
      topics: 64,
    });
  });

  it("carries a question at every limit in one answer of 1 024 bytes", () => {
    const bytes = trainerQuestionDataBytes({
      topic: cyrillic(40),
      text: cyrillic(160),
      options: [cyrillic(60), cyrillic(60), cyrillic(60), cyrillic(60)],
    });

    expect(bytes).toBeLessThanOrEqual(1_024);
    // 2 bytes per letter of the topic, the question and the options, before the envelope.
    expect(bytes).toBeGreaterThan(2 * (40 + 160 + 240));
  });

  it("carries an explanation at its limit in one answer of 1 024 bytes", () => {
    const bytes = trainerExplanationDataBytes({ explanation: cyrillic(200) });

    expect(bytes).toBeLessThanOrEqual(1_024);
    expect(bytes).toBeGreaterThan(2 * 200);
  });

  it("counts bytes, not characters: three-byte signs can break a question that fits by length", () => {
    expect(
      trainerQuestionDataBytes({
        topic: "€".repeat(40),
        text: "€".repeat(160),
        options: ["€".repeat(120), "€".repeat(120)],
      }),
    ).toBeGreaterThan(1_024);
  });

  it("counts a quote as two bytes because JSON escapes it", () => {
    const plain = trainerExplanationDataBytes({ explanation: "aa" });
    const quoted = trainerExplanationDataBytes({ explanation: 'a"' });

    expect(quoted - plain).toBe(1);
  });

  it("refuses to encode data that Telegram would reject", () => {
    expect(() => encodeTrainerWidgetData(["x", cyrillic(600)])).toThrow(
      RangeError,
    );
    expect(encodeTrainerWidgetData(["h", 4, 3, 5, 0])).toBe('["h",4,3,5,0]');
  });

  it("carries the fullest topic list, Progress and Rating in 1 024 bytes", () => {
    const names = Array.from({ length: 9 }, () => cyrillic(40));

    expect(() =>
      encodeTrainerWidgetData([
        "t",
        names.map((name) => ["abcdefghijklmnop", name, 999, 999]),
      ]),
    ).not.toThrow();
    expect(() =>
      encodeTrainerWidgetData([
        "p",
        99_999,
        9_999,
        99_999,
        names.map((name) => [name, 999, 999, 100] as const),
      ]),
    ).not.toThrow();
    expect(TRAINER_RATING_ROWS_MAX).toBe(8);
    expect(() =>
      encodeTrainerWidgetData([
        "l",
        1,
        1,
        Array.from({ length: 8 }, () => [
          999_999,
          // Names may hold four-byte signs: 𝒜 is one character and four bytes.
          "𝒜".repeat(TRAINER_RATING_NAME_MAX_CHARS),
          999_999,
          1,
        ]),
      ]),
    ).not.toThrow();
  });

  it("counts characters as code points of the composed form", () => {
    expect(trainerTextLength("й")).toBe(1);
    expect(trainerTextLength("й")).toBe(1);
    expect(trainerTextLength("𝒜")).toBe(1);
  });

  it.each([
    ["h", { kind: "home" }],
    ["q", { kind: "start_check" }],
    ["d", { kind: "start_daily" }],
    ["t", { kind: "topics" }],
    ["trag", { kind: "start_topic", topicCode: "rag" }],
    ["p", { kind: "progress" }],
    ["l0", { kind: "rating", allTime: false }],
    ["l1", { kind: "rating", allTime: true }],
    ["v11", { kind: "set_rating_shown", shown: true, allTime: true }],
    ["v00", { kind: "set_rating_shown", shown: false, allTime: false }],
    ["n", { kind: "next" }],
    ["a1a2b3c:5", { kind: "answer", issueId: "1a2b3c", optionMask: 5 }],
    ["a7:0", { kind: "answer", issueId: "7", optionMask: 0 }],
  ])("reads the request %s", (data, expected) => {
    expect(parseTrainerWidgetRequest(data)).toEqual(expected);
  });

  it.each([
    "",
    "z",
    "a:1",
    "a1a2b3c:16",
    "a1a2b3c:-1",
    "aABC:1",
    "t" + "a".repeat(17),
    "tРАГ",
    "l2",
    "v2",
    "h".repeat(65),
  ])("ignores the unknown request %j", (data) => {
    expect(parseTrainerWidgetRequest(data)).toBeUndefined();
  });
});
