"use client";
import { createContext, useContext, useState, type ReactNode } from "react";

/** What the reader answered: chosen option ids, or «Не знаю». */
export type ExerciseAnswer =
  | { readonly kind: "options"; readonly optionIds: readonly string[] }
  | { readonly kind: "dontKnow" };

/** One checked answer to a Lesson Exercise and its result. */
export interface ExerciseAnswerRecord {
  readonly answer: ExerciseAnswer;
  readonly result: "correct" | "incorrect" | "dontKnow";
}

/** The current answer of one exercise and the two things a reader can do with it. */
export interface ExerciseAnswerState {
  readonly current: ExerciseAnswerRecord | null;
  /** Records a checked answer: an Exercise Attempt once attempts are stored (#2121). */
  readonly answer: (record: ExerciseAnswerRecord) => void;
  /** «Ответить ещё раз»: clears the shown answer; earlier attempts stay recorded. */
  readonly retry: () => void;
}

/**
 * Where answers live. It is a React hook keyed by the author's exercise id: the default keeps the
 * answer in the component until the page closes. Attempts storage (#2121) supplies its own through
 * `ExerciseAnswersProvider` to restore past answers and record each check.
 */
export type ExerciseAnswerSource = (exerciseId: string) => ExerciseAnswerState;

function useComponentExerciseAnswer(): ExerciseAnswerState {
  const [current, setCurrent] = useState<ExerciseAnswerRecord | null>(null);
  return {
    current,
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

export function useExerciseAnswer(exerciseId: string): ExerciseAnswerState {
  return useContext(ExerciseAnswerSourceContext)(exerciseId);
}
