import { expect, test } from "vitest";
import { lessonInteractions as facts } from "../../../../scenarios/lesson-interactions.mjs";
import { exerciseAttemptSchema } from "@/features/exercise-attempts/model/exercise-attempt-contract";
import {
  exerciseStatisticsSchema,
  lessonRatingCountsSchema,
} from "@/features/lesson-statistics/model/lesson-statistics-contract";

test("the common attempt and statistics snapshots fit the real frontend contracts", () => {
  expect(exerciseAttemptSchema.parse(facts.attempt)).toMatchObject({
    exerciseId: "rag-wrong-platform",
    fingerprint: "669258ca11c32c41",
    answer: { kind: "options", optionIds: ["prompt"] },
    result: "correct",
    firstForVersion: true,
    attemptedAt: "2026-11-13T09:00:00.000Z",
  });
  expect(
    facts.module.statistics.map((row) => exerciseStatisticsSchema.parse(row)),
  ).toMatchObject([
    {
      exerciseId: "rag-wrong-platform",
      kind: "quiz",
      versions: [
        {
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
  ]);
  expect(lessonRatingCountsSchema.parse(facts.module.ratings)).toEqual({
    likes: 3,
    dislikes: 1,
  });
  expect(lessonRatingCountsSchema.parse(facts.reader.ratings)).toEqual({
    likes: 12,
    dislikes: 3,
  });
});
