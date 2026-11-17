import { lessonInteractions as facts } from "../../../../scenarios/lesson-interactions.mjs";
import type { LessonStatisticsState } from "@/features/lesson-statistics";

/** Presentation adapter; its large/old-version state differs deliberately from the HTTP variant. */
export const lessonStatisticsScenario: LessonStatisticsState = {
  kind: "ready",
  ratings: facts.storybook.ratings,
  exercises: [
    {
      exerciseId: facts.exercise.id,
      title: "Упражнение 1",
      question: facts.exercise.question,
      versions: facts.storybook.versions.map((version) => ({
        fingerprint: version.fingerprint,
        current: version.current,
        firstAnsweredAt: version.firstAnsweredAt,
        respondents: version.respondents,
        firstTryCorrectPercent: version.firstTryCorrectPercent,
        firstTryDontKnow: version.firstTryDontKnow,
        mostFrequentWrong: {
          label: "Частый неверный ответ",
          text: facts.exercise.options[version.wrongOption],
          count: version.wrongCount,
        },
      })),
    },
    {
      exerciseId: facts.storybook.unanswered.id,
      title: "Упражнение 2",
      question: facts.storybook.unanswered.question,
      versions: [],
    },
  ],
};
