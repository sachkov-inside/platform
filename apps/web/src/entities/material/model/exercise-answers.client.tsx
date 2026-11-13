"use client";
import type { ExerciseAnswer, ExerciseResult } from "@inside/material-blocks";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

/** What the reader answered: options, matches, a sequence or «Не знаю» (`@inside/material-blocks`). */
export type { ExerciseAnswer };

/** One checked answer to a Lesson Exercise and its result. */
export interface ExerciseAnswerRecord {
  readonly answer: ExerciseAnswer;
  readonly result: ExerciseResult;
}

/** The current answer of one exercise and the two things a reader can do with it. */
export interface ExerciseAnswerState {
  readonly current: ExerciseAnswerRecord | null;
  /** The shown answer belongs to an older version: «Упражнение обновлено, ответь ещё раз». */
  readonly updated: boolean;
  /** A line under the exercise from the answer source, such as the sign-in offer to a guest. */
  readonly note?: ReactNode;
  /** Records a checked answer as an Exercise Attempt, or in the guest's browser. */
  readonly answer: (record: ExerciseAnswerRecord) => void;
  /** «Ответить ещё раз»: clears the shown answer; earlier attempts stay recorded. */
  readonly retry: () => void;
}

/**
 * Where answers live. It is a React hook keyed by the author's exercise id: the default keeps the
 * answer in the component until the page closes. The lesson reader supplies Exercise Attempts
 * (`@/features/exercise-attempts`) through `ExerciseAnswersProvider` to restore past answers and
 * record each check.
 */
export type ExerciseAnswerSource = (exerciseId: string) => ExerciseAnswerState;

function useComponentExerciseAnswer(): ExerciseAnswerState {
  const [current, setCurrent] = useState<ExerciseAnswerRecord | null>(null);
  return {
    current,
    updated: false,
    answer: setCurrent,
    retry: () => {
      setCurrent(null);
    },
  };
}

const ExerciseAnswerSourceContext = createContext<ExerciseAnswerSource>(
  useComponentExerciseAnswer,
);

/**
 * Supplies the answer source for every exercise below. The source is called as a hook, so one
 * provider keeps the same source for its whole life.
 */
export function ExerciseAnswersProvider({
  source,
  children,
}: {
  readonly source: ExerciseAnswerSource;
  readonly children: ReactNode;
}) {
  return (
    <ExerciseAnswerSourceContext value={source}>
      {children}
    </ExerciseAnswerSourceContext>
  );
}

/**
 * Reports, without storing anything, that an exercise below has an answer: a new check or one the
 * source restored. Step-by-step reveal (#2122) opens the text after an «after answer» exercise by
 * it. It wraps whichever source is above it, so it stays below any `ExerciseAnswersProvider`.
 */
export function ExerciseAnswersObserver({
  onAnswered,
  children,
}: {
  readonly onAnswered: (exerciseId: string) => void;
  readonly children: ReactNode;
}) {
  const inner = useContext(ExerciseAnswerSourceContext);
  const listener = useRef(onAnswered);
  useEffect(() => {
    listener.current = onAnswered;
  });
  const [source] = useState<ExerciseAnswerSource>(
    () =>
      function useObservedExerciseAnswer(exerciseId: string) {
        const state = inner(exerciseId);
        const answered = state.current !== null;
        useEffect(() => {
          if (answered) listener.current(exerciseId);
        }, [answered, exerciseId]);
        return state;
      },
  );
  return (
    <ExerciseAnswerSourceContext value={source}>
      {children}
    </ExerciseAnswerSourceContext>
  );
}

export function useExerciseAnswer(exerciseId: string): ExerciseAnswerState {
  return useContext(ExerciseAnswerSourceContext)(exerciseId);
}
