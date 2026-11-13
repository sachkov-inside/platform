"use client";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

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
