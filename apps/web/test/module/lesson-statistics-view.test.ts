import { exerciseFingerprint } from "@inside/material-blocks";
import { describe, expect, it } from "vitest";

import type { ExerciseStatistics } from "@/features/lesson-statistics/model/lesson-statistics-contract";
import {
  documentExercises,
  lessonStatisticsView,
} from "@/features/lesson-statistics/model/lesson-statistics-view";

const text = (value: string) => [
  { kind: "paragraph", content: [{ kind: "text", text: value, marks: [] }] },
];

const quiz = {
  kind: "quiz",
  id: "rag-wrong-platform",
  reveal: "none",
  question: text("На каком шаге ошибка?"),
  selectionMode: "single",
  options: [
    {
      id: "embed",
      content: text("Эмбеддинги"),
      correct: false,
      explanation: text("Нет"),
    },
    { id: "prompt", content: text("Промпт"), correct: true },
  ],
};

const match = {
  kind: "match",
  id: "layers",
  reveal: "none",
  question: text("Сопоставь слои"),
  mode: "pairs",
  rows: ["domain", "api", "store"].map((id) => ({
    id,
    content: text(`Строка ${id}`),
    answerId: `${id}-choice`,
    explanation: text("Почему"),
  })),
  choices: ["domain", "api", "store"].map((id) => ({
    id: `${id}-choice`,
    content: text(`Слой ${id}`),
  })),
};

const order = {
  kind: "order",
  id: "pipeline",
  reveal: "none",
  question: text("Расставь шаги"),
  steps: ["spec", "code", "ship"].map((id) => ({
    id,
    content: text(`Шаг ${id}`),
    explanation: text("Почему"),
  })),
};

const document = {
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "Вступление" }] },
    { type: "quiz", attrs: { nodeId: "a", exercise: quiz } },
    {
      type: "blockquote",
      content: [{ type: "match", attrs: { nodeId: "b", exercise: match } }],
    },
    { type: "order", attrs: { nodeId: "c", exercise: order } },
    { type: "quiz", attrs: { nodeId: "d", exercise: { kind: "quiz" } } },
  ],
};

const version = (input: {
  readonly fingerprint: string;
  readonly at: string;
  readonly respondents: number;
  readonly correct: number;
  readonly wrong?: ExerciseStatistics["versions"][number]["mostFrequentMistake"];
}) => ({
  fingerprint: input.fingerprint,
  firstAnsweredAt: input.at,
  respondents: input.respondents,
  firstTryCorrect: input.correct,
  firstTryDontKnow: 0,
  mostFrequentMistake: input.wrong ?? null,
});

describe("lesson statistics view", () => {
  it("finds the exercises of the edited document in reading order and skips broken ones", () => {
    expect(documentExercises(document).map((exercise) => exercise.id)).toEqual([
      "rag-wrong-platform",
      "layers",
      "pipeline",
    ]);
  });

  it("numbers exercises as in the lesson, puts the current version first and names mistakes by their text", () => {
    const exercises = documentExercises(document);
    const [quizExercise, matchExercise, orderExercise] = exercises;
    if (
      quizExercise === undefined ||
      matchExercise === undefined ||
      orderExercise === undefined
    )
      throw new Error("Exercises must parse");
    const view = lessonStatisticsView(exercises, [
      {
        exerciseId: "layers",
        kind: "match",
        versions: [
          version({
            fingerprint: exerciseFingerprint(matchExercise),
            at: "2026-11-01T09:00:00.000Z",
            respondents: 3,
            correct: 1,
            wrong: {
              kind: "pair",
              rowId: "api",
              choiceId: "store-choice",
              count: 2,
            },
          }),
        ],
      },
      {
        exerciseId: "old-exercise",
        kind: "order",
        versions: [
          version({
            fingerprint: "0000000000000001",
            at: "2026-10-01T09:00:00.000Z",
            respondents: 2,
            correct: 2,
          }),
        ],
      },
      {
        exerciseId: "pipeline",
        kind: "order",
        versions: [
          version({
            fingerprint: exerciseFingerprint(orderExercise),
            at: "2026-11-01T09:00:00.000Z",
            respondents: 1,
            correct: 0,
            wrong: { kind: "step", stepId: "code", count: 1 },
          }),
        ],
      },
      {
        exerciseId: "rag-wrong-platform",
        kind: "quiz",
        versions: [
          version({
            fingerprint: "00000000000000aa",
            at: "2026-10-01T09:00:00.000Z",
            respondents: 4,
            correct: 1,
            wrong: { kind: "options", optionIds: ["gone"], count: 3 },
          }),
          version({
            fingerprint: exerciseFingerprint(quizExercise),
            at: "2026-11-01T09:00:00.000Z",
            respondents: 3,
            correct: 2,
            wrong: { kind: "options", optionIds: ["embed"], count: 1 },
          }),
        ],
      },
    ]);

    expect(view).toEqual([
      {
        exerciseId: "rag-wrong-platform",
        title: "Упражнение 1",
        question: "На каком шаге ошибка?",
        versions: [
          {
            fingerprint: exerciseFingerprint(quizExercise),
            current: true,
            firstAnsweredAt: "2026-11-01T09:00:00.000Z",
            respondents: 3,
            firstTryCorrectPercent: 67,
            firstTryDontKnow: 0,
            mostFrequentWrong: {
              label: "Частый неверный ответ",
              text: "Эмбеддинги",
              count: 1,
            },
          },
          {
            fingerprint: "00000000000000aa",
            current: false,
            firstAnsweredAt: "2026-10-01T09:00:00.000Z",
            respondents: 4,
            firstTryCorrectPercent: 25,
            firstTryDontKnow: 0,
            // An option of an old version is no longer in the lesson: its id stands for it.
            mostFrequentWrong: {
              label: "Частый неверный ответ",
              text: "gone",
              count: 3,
            },
          },
        ],
      },
      {
        exerciseId: "layers",
        title: "Упражнение 2",
        question: "Сопоставь слои",
        versions: [
          {
            fingerprint: exerciseFingerprint(matchExercise),
            current: true,
            firstAnsweredAt: "2026-11-01T09:00:00.000Z",
            respondents: 3,
            firstTryCorrectPercent: 33,
            firstTryDontKnow: 0,
            mostFrequentWrong: {
              label: "Частая неверная пара",
              text: "Строка api → Слой store",
              count: 2,
            },
          },
        ],
      },
      {
        exerciseId: "pipeline",
        title: "Упражнение 3",
        question: "Расставь шаги",
        versions: [
          {
            fingerprint: exerciseFingerprint(orderExercise),
            current: true,
            firstAnsweredAt: "2026-11-01T09:00:00.000Z",
            respondents: 1,
            firstTryCorrectPercent: 0,
            firstTryDontKnow: 0,
            mostFrequentWrong: {
              label: "Чаще всего не на своём месте",
              text: "Шаг code",
              count: 1,
            },
          },
        ],
      },
      {
        exerciseId: "old-exercise",
        title: "Убрано из урока",
        question: "old-exercise",
        versions: [
          {
            fingerprint: "0000000000000001",
            current: false,
            firstAnsweredAt: "2026-10-01T09:00:00.000Z",
            respondents: 2,
            firstTryCorrectPercent: 100,
            firstTryDontKnow: 0,
            mostFrequentWrong: null,
          },
        ],
      },
    ]);
  });

  it("shows an exercise nobody has answered yet with no versions", () => {
    const view = lessonStatisticsView(documentExercises(document), []);
    expect(view.map((exercise) => [exercise.title, exercise.versions])).toEqual(
      [
        ["Упражнение 1", []],
        ["Упражнение 2", []],
        ["Упражнение 3", []],
      ],
    );
  });
});
