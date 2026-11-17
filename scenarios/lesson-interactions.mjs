// @ts-check
// Authored exercise-version snapshots, not a definition inferred from a fingerprint.
const exercise = {
  id: "rag-wrong-platform",
  kind: "quiz",
  fingerprint: "669258ca11c32c41",
  question: "На каком шаге RAG ошибается чаще всего?",
  options: { embed: "Эмбеддинги", prompt: "Промпт" },
};
const attemptDate = "2026-11-13T09:00:00.000Z";

export const lessonInteractions = /** @type {const} */ ({
  materialId: "6d155605-f852-461a-bdeb-df68b0b441c4",
  exercise,
  attempt: {
    exerciseId: exercise.id,
    fingerprint: exercise.fingerprint,
    answer: { kind: "options", optionIds: ["prompt"] },
    result: "correct",
    firstForVersion: true,
    attemptedAt: attemptDate,
  },
  module: {
    ratings: { likes: 3, dislikes: 1 },
    statistics: [
      {
        exerciseId: exercise.id,
        kind: exercise.kind,
        versions: [
          {
            fingerprint: exercise.fingerprint,
            firstAnsweredAt: attemptDate,
            respondents: 4,
            firstTryCorrect: 1,
            firstTryDontKnow: 1,
            mostFrequentMistake: {
              kind: "options",
              optionIds: ["embed"],
              count: 2,
            },
          },
        ],
      },
    ],
  },
  storybook: {
    ratings: { likes: 12, dislikes: 3 },
    versions: [
      {
        fingerprint: exercise.fingerprint,
        current: true,
        firstAnsweredAt: "2026-11-10T09:00:00.000Z",
        respondents: 40,
        firstTryCorrectPercent: 55,
        firstTryDontKnow: 4,
        wrongOption: "embed",
        wrongCount: 11,
      },
      {
        fingerprint: "00000000000000aa",
        current: false,
        firstAnsweredAt: "2026-10-01T09:00:00.000Z",
        respondents: 18,
        firstTryCorrectPercent: 28,
        firstTryDontKnow: 0,
        wrongOption: "prompt",
        wrongCount: 9,
      },
    ],
    unanswered: { id: "pipeline", question: "Расставь шаги поставки" },
  },
});
