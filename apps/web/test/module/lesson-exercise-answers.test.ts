import {
  exerciseFingerprint,
  type RenderedBlock,
} from "@inside/material-blocks";
import { describe, expect, it } from "vitest";

import {
  guestExerciseAnswers,
  type GuestAnswerStorage,
} from "@/features/exercise-attempts/model/guest-exercise-answers";
import {
  exerciseAnswerView,
  lessonExercises,
  lessonExerciseSummary,
  type StoredExerciseAnswer,
} from "@/features/exercise-attempts/model/lesson-exercises";

const paragraph = (text: string): RenderedBlock => ({
  kind: "paragraph",
  content: [{ kind: "text", text, marks: [] }],
});

function quiz(id: string, correct = "right"): RenderedBlock {
  return {
    kind: "quiz",
    id,
    reveal: "none",
    question: [paragraph("Вопрос")],
    selectionMode: "single",
    options: ["right", "wrong"].map((option) => ({
      id: option,
      content: [paragraph(option)],
      correct: option === correct,
      ...(option === correct ? {} : { explanation: [paragraph("Нет")] }),
    })),
  };
}

const body: readonly RenderedBlock[] = [
  paragraph("Вступление"),
  quiz("first"),
  paragraph("Середина"),
  quiz("second"),
  quiz("third"),
];

describe("lesson exercises", () => {
  it("lists exercises in reading order with their number and current version", () => {
    const exercises = lessonExercises(body);
    expect(exercises.map(({ id, number }) => [id, number])).toEqual([
      ["first", 1],
      ["second", 2],
      ["third", 3],
    ]);
    expect(exercises[0]?.fingerprint).toMatch(/^[0-9a-f]{16}$/u);
  });

  it("restores a past answer and marks it updated only when the version changed", () => {
    const [first] = lessonExercises(body);
    if (first === undefined) throw new Error("No exercise");
    const stored: StoredExerciseAnswer = {
      answer: { kind: "options", optionIds: ["right"] },
      result: "correct",
      fingerprint: first.fingerprint,
    };
    expect(exerciseAnswerView(first, stored)).toEqual({
      current: { answer: stored.answer, result: "correct" },
      updated: false,
    });
    expect(
      exerciseAnswerView(first, { ...stored, fingerprint: "0000000000000000" }),
    ).toEqual({
      current: { answer: stored.answer, result: "correct" },
      updated: true,
    });
    expect(exerciseAnswerView(first, undefined)).toEqual({
      current: null,
      updated: false,
    });
  });

  it("counts an exercise solved when its latest answer on the current version is correct", () => {
    const exercises = lessonExercises(body);
    const [first, second, third] = exercises;
    if (first === undefined || second === undefined || third === undefined)
      throw new Error("Three exercises");
    const answers = new Map<string, StoredExerciseAnswer>([
      [
        "first",
        {
          answer: { kind: "options", optionIds: ["right"] },
          result: "correct",
          fingerprint: first.fingerprint,
        },
      ],
      [
        "second",
        {
          answer: { kind: "options", optionIds: ["wrong"] },
          result: "incorrect",
          fingerprint: second.fingerprint,
        },
      ],
      [
        // Correct on an older version: the exercise changed since.
        "third",
        {
          answer: { kind: "options", optionIds: ["right"] },
          result: "correct",
          fingerprint: exerciseFingerprint({
            kind: "quiz",
            selectionMode: "single",
            options: [
              { id: "right", correct: false },
              { id: "wrong", correct: true },
            ],
          }),
        },
      ],
    ]);
    expect(lessonExerciseSummary(exercises, answers)).toEqual({
      total: 3,
      solved: 1,
      unsolved: [second, third],
    });
  });
});

describe("guest exercise answers", () => {
  function memoryStorage(): GuestAnswerStorage & {
    readonly values: Map<string, string>;
  } {
    const values = new Map<string, string>();
    return {
      values,
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        values.set(key, value);
      },
    };
  }
  const answer: StoredExerciseAnswer = {
    answer: { kind: "options", optionIds: ["right"] },
    result: "correct",
    fingerprint: "0123456789abcdef",
  };

  it("keeps answers per lesson in the browser only", () => {
    const storage = memoryStorage();
    const lesson = guestExerciseAnswers(storage, "lesson-a");
    lesson.save("first", answer);
    expect(lesson.read()).toEqual(new Map([["first", answer]]));
    expect(guestExerciseAnswers(storage, "lesson-b").read()).toEqual(new Map());
    expect([...storage.values.keys()]).toEqual([
      "inside.exercise-answers.v1:lesson-a",
    ]);
  });

  it("drops a malformed or foreign value instead of showing it", () => {
    const storage = memoryStorage();
    storage.setItem("inside.exercise-answers.v1:lesson-a", "{not json");
    expect(guestExerciseAnswers(storage, "lesson-a").read()).toEqual(new Map());
    storage.setItem(
      "inside.exercise-answers.v1:lesson-a",
      JSON.stringify({ first: { ...answer, result: "excellent" } }),
    );
    expect(guestExerciseAnswers(storage, "lesson-a").read()).toEqual(new Map());
  });

  it("keeps working when the browser blocks storage", () => {
    const blocked: GuestAnswerStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    const lesson = guestExerciseAnswers(blocked, "lesson-a");
    expect(() => {
      lesson.save("first", answer);
    }).not.toThrow();
    expect(lesson.read()).toEqual(new Map());
  });
});
