import {
  exerciseFingerprint,
  materialExercises,
  type ExerciseAnswer,
  type ExerciseResult,
  type RenderedBlock,
} from "@inside/material-blocks";
import type { ExerciseAnswerRecord } from "@/entities/material";

/** An exercise of the open lesson: its id, «Упражнение N», and the version on the page. */
export interface LessonExercise {
  readonly id: string;
  readonly number: number;
  readonly fingerprint: string;
}

/** The reader's latest answer on an exercise and the version it was checked against. */
export interface StoredExerciseAnswer {
  readonly answer: ExerciseAnswer;
  readonly result: ExerciseResult;
  readonly fingerprint: string;
}

export function lessonExercises(
  blocks: readonly RenderedBlock[],
): readonly LessonExercise[] {
  return materialExercises(blocks).map((exercise, index) => ({
    id: exercise.id,
    number: index + 1,
    fingerprint: exerciseFingerprint(exercise),
  }));
}

/**
 * What an exercise shows: the past answer and its result, and whether the exercise changed since
 * («Упражнение обновлено, ответь ещё раз»). The past answer stays visible after an update.
 */
export function exerciseAnswerView(
  exercise: LessonExercise,
  stored: StoredExerciseAnswer | undefined,
): {
  readonly current: ExerciseAnswerRecord | null;
  readonly updated: boolean;
} {
  return stored === undefined
    ? { current: null, updated: false }
    : {
        current: { answer: stored.answer, result: stored.result },
        updated: stored.fingerprint !== exercise.fingerprint,
      };
}

/**
 * «Упражнения: 3 из 4 решены»: an exercise is solved when the latest answer on its current
 * version is correct. A correct answer to an older version does not count.
 */
export function lessonExerciseSummary(
  exercises: readonly LessonExercise[],
  answers: ReadonlyMap<string, StoredExerciseAnswer>,
): {
  readonly total: number;
  readonly solved: number;
  readonly unsolved: readonly LessonExercise[];
} {
  const unsolved = exercises.filter((exercise) => {
    const stored = answers.get(exercise.id);
    return (
      stored?.fingerprint !== exercise.fingerprint ||
      stored.result !== "correct"
    );
  });
  return {
    total: exercises.length,
    solved: exercises.length - unsolved.length,
    unsolved,
  };
}
