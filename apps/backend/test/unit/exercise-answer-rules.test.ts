import {
  checkExerciseAnswer,
  exerciseAnswerSchema,
  exerciseFingerprint,
  type ExerciseKey,
} from "@inside/material-blocks";
import { describe, expect, test } from "vitest";

const quiz: ExerciseKey = {
  kind: "quiz",
  selectionMode: "single",
  options: [
    { id: "embed", correct: false },
    { id: "prompt", correct: true },
    { id: "rerank", correct: false },
  ],
  dontKnow: { reviewLinks: ["#section"] },
};
const multiple: ExerciseKey = {
  kind: "quiz",
  selectionMode: "multiple",
  options: [
    { id: "a", correct: true },
    { id: "b", correct: true },
    { id: "c", correct: false },
  ],
};
const match: ExerciseKey = {
  kind: "match",
  mode: "pairs",
  rows: [
    { id: "plan", answerId: "plan-role" },
    { id: "code", answerId: "code-role" },
    { id: "test", answerId: "test-role" },
  ],
  choices: [{ id: "plan-role" }, { id: "code-role" }, { id: "test-role" }],
};
const order: ExerciseKey = {
  kind: "order",
  steps: [{ id: "spec" }, { id: "code" }, { id: "ship" }],
};

describe("exercise answer check", () => {
  test("a quiz is correct only when the chosen set equals the correct set", () => {
    expect(
      checkExerciseAnswer(quiz, { kind: "options", optionIds: ["prompt"] }),
    ).toBe("correct");
    expect(
      checkExerciseAnswer(quiz, { kind: "options", optionIds: ["embed"] }),
    ).toBe("incorrect");
    expect(
      checkExerciseAnswer(multiple, {
        kind: "options",
        optionIds: ["b", "a"],
      }),
    ).toBe("correct");
    expect(
      checkExerciseAnswer(multiple, { kind: "options", optionIds: ["a"] }),
    ).toBe("incorrect");
  });

  test("a quiz answer must name existing options, once, and one for a single choice", () => {
    for (const optionIds of [["missing"], ["embed", "prompt"], []])
      expect(checkExerciseAnswer(quiz, { kind: "options", optionIds })).toBe(
        undefined,
      );
    expect(
      checkExerciseAnswer(multiple, { kind: "options", optionIds: ["a", "a"] }),
    ).toBe(undefined);
  });

  test("a match is correct when every row names its own choice", () => {
    const matches = (pairs: readonly (readonly [string, string])[]) => ({
      kind: "matches" as const,
      matches: pairs.map(([rowId, choiceId]) => ({ rowId, choiceId })),
    });
    expect(
      checkExerciseAnswer(
        match,
        matches([
          ["test", "test-role"],
          ["plan", "plan-role"],
          ["code", "code-role"],
        ]),
      ),
    ).toBe("correct");
    expect(
      checkExerciseAnswer(
        match,
        matches([
          ["plan", "code-role"],
          ["code", "plan-role"],
          ["test", "test-role"],
        ]),
      ),
    ).toBe("incorrect");
    // Every row once, every choice known.
    expect(
      checkExerciseAnswer(
        match,
        matches([
          ["plan", "plan-role"],
          ["code", "code-role"],
        ]),
      ),
    ).toBe(undefined);
    expect(
      checkExerciseAnswer(
        match,
        matches([
          ["plan", "plan-role"],
          ["plan", "plan-role"],
          ["test", "test-role"],
        ]),
      ),
    ).toBe(undefined);
    expect(
      checkExerciseAnswer(
        match,
        matches([
          ["plan", "plan-role"],
          ["code", "other"],
          ["test", "test-role"],
        ]),
      ),
    ).toBe(undefined);
  });

  test("an order is correct in the stored sequence and needs every step once", () => {
    expect(
      checkExerciseAnswer(order, {
        kind: "sequence",
        stepIds: ["spec", "code", "ship"],
      }),
    ).toBe("correct");
    expect(
      checkExerciseAnswer(order, {
        kind: "sequence",
        stepIds: ["code", "spec", "ship"],
      }),
    ).toBe("incorrect");
    expect(
      checkExerciseAnswer(order, {
        kind: "sequence",
        stepIds: ["spec", "spec", "ship"],
      }),
    ).toBe(undefined);
    expect(
      checkExerciseAnswer(order, { kind: "sequence", stepIds: ["spec"] }),
    ).toBe(undefined);
  });

  test("«Не знаю» counts only where the author offered it, and kinds do not cross", () => {
    expect(checkExerciseAnswer(quiz, { kind: "dontKnow" })).toBe("dontKnow");
    expect(checkExerciseAnswer(order, { kind: "dontKnow" })).toBe(undefined);
    expect(
      checkExerciseAnswer(order, { kind: "options", optionIds: ["spec"] }),
    ).toBe(undefined);
    expect(
      checkExerciseAnswer(quiz, { kind: "sequence", stepIds: ["prompt"] }),
    ).toBe(undefined);
  });
});

describe("exercise version fingerprint", () => {
  test("ignores wording, option order and «Не знаю»", () => {
    const reordered: ExerciseKey = {
      kind: "quiz",
      selectionMode: "single",
      options: [
        { id: "rerank", correct: false },
        { id: "prompt", correct: true },
        { id: "embed", correct: false },
      ],
    };
    expect(exerciseFingerprint(reordered)).toBe(exerciseFingerprint(quiz));
    expect(exerciseFingerprint(quiz)).toMatch(/^[0-9a-f]{16}$/u);
  });

  test("changes with options, rows, steps and the key", () => {
    const fingerprints = new Set(
      [
        quiz,
        { ...quiz, options: quiz.options.slice(0, 2) },
        {
          ...quiz,
          options: quiz.options.map((option) => ({
            ...option,
            correct: option.id === "embed",
          })),
        },
        match,
        {
          ...match,
          rows: match.rows.map((row, index) => ({
            ...row,
            answerId: match.choices[(index + 1) % 3]?.id ?? "",
          })),
        },
        order,
        { ...order, steps: [...order.steps].reverse() },
      ].map((key) => exerciseFingerprint(key)),
    );
    expect(fingerprints.size).toBe(7);
  });

  test("is a known value, so web and backend agree across releases", () => {
    // 64-bit FNV-1a of "order|spec,code,ship", computed outside this code.
    expect(exerciseFingerprint(order)).toBe("fedf00a6d2dab0fb");
  });
});

describe("exercise answer shape", () => {
  test("accepts the four answer kinds and rejects anything else", () => {
    for (const answer of [
      { kind: "options", optionIds: ["a"] },
      { kind: "matches", matches: [{ rowId: "r", choiceId: "c" }] },
      { kind: "sequence", stepIds: ["a", "b", "c"] },
      { kind: "dontKnow" },
    ])
      expect(exerciseAnswerSchema.safeParse(answer).success).toBe(true);
    for (const answer of [
      { kind: "options", optionIds: ["Not An Id"] },
      { kind: "options", optionIds: Array.from({ length: 9 }, () => "a") },
      { kind: "sequence", stepIds: [] },
      { kind: "dontKnow", extra: true },
      { kind: "result", value: "correct" },
    ])
      expect(exerciseAnswerSchema.safeParse(answer).success).toBe(false);
  });
});
