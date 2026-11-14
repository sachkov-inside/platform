"use client";
import { useSyncExternalStore, type ReactNode } from "react";

import { cn } from "@/shared/lib/utils";

import { ExerciseAnswersObserver } from "../model/exercise-answers.client";
import type { LessonGate } from "../model/lesson-parts";
import {
  lessonGateElementId,
  lessonPartShows,
  useLessonSteps,
} from "../model/lesson-steps.client";
import styles from "./lesson-steps.module.css";

const subscribeNothing = () => () => undefined;

/** False in the server render and during hydration, true afterwards. */
function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribeNothing,
    () => true,
    () => false,
  );
}

/** Start of a part: while the part is closed, every block after this marker is hidden. */
export function LessonCut({ part }: { readonly part: number }) {
  const steps = useLessonSteps();
  const hydrated = useHydrated();
  const closed = !lessonPartShows(steps, part);
  return (
    <span
      className={styles["cut"]}
      data-closed={closed ? "" : undefined}
      data-hydrated={hydrated ? "" : undefined}
      data-lesson-part={part}
      hidden
    />
  );
}

/**
 * End of the part a gate closes. A step break shows its button until pressed, then the reader's
 * reply in its place; an «after answer» exercise offers «Пропустить» until the first answer.
 */
export function LessonGateControl({
  gate,
  ordinal,
}: {
  readonly gate: LessonGate;
  readonly ordinal: number;
}) {
  const steps = useLessonSteps();
  if (steps === null) return null;
  const passed = ordinal + 1 < steps.opened;
  const waiting = !passed && !steps.whole;
  return (
    <div
      className="scroll-mt-24 outline-none"
      data-lesson-gate={gate.kind}
      id={lessonGateElementId(ordinal)}
      tabIndex={-1}
    >
      {gate.kind === "break" ? (
        passed ? (
          <LessonReply label={gate.label} />
        ) : waiting ? (
          <div className={cn("mt-10 flex justify-center", styles["control"])}>
            <button
              className="min-h-11 max-w-[90%] rounded-full bg-lesson-graphite px-5 py-2.5 text-center font-medium text-lesson-graphite-foreground shadow-sm transition-colors duration-(--motion-duration-fast) hover:bg-lesson-graphite-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none"
              onClick={() => {
                steps.openThrough(ordinal + 1, "reply");
              }}
              type="button"
            >
              {gate.label}
            </button>
          </div>
        ) : null
      ) : waiting ? (
        <div className={cn("mt-3 flex justify-end", styles["control"])}>
          <button
            className="min-h-11 px-1 text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            onClick={() => {
              steps.openThrough(ordinal + 1);
            }}
            type="button"
          >
            Пропустить
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** The pressed button stays in the lesson as the reader's own line, on the right. */
function LessonReply({ label }: { readonly label: string }) {
  const steps = useLessonSteps();
  if (steps === null) return null;
  return (
    <div
      className="mt-8 mb-2 flex items-end justify-end gap-2"
      data-lesson-reply
    >
      <div className="flex max-w-[85%] min-w-0 flex-col items-end gap-1">
        <span className="text-xs text-muted-foreground">
          {steps.reader.name}
        </span>
        <p className="rounded-2xl rounded-br-sm bg-lesson-reply px-4 py-2.5 text-foreground">
          {label}
        </p>
      </div>
      {steps.reader.avatar}
    </div>
  );
}

/** The first answer to an «after answer» exercise opens the text below it. */
export function LessonExerciseAnswers({
  children,
}: {
  readonly children: ReactNode;
}) {
  const steps = useLessonSteps();
  if (steps === null) return children;
  return (
    <ExerciseAnswersObserver onAnswered={steps.answered}>
      {children}
    </ExerciseAnswersObserver>
  );
}

/**
 * What follows the last part, such as the term deck or the reading panel under the lesson: it
 * waits until the lesson is open, so an open part does not read as the end of the lesson.
 */
export function LessonStepsTail({
  children,
}: {
  readonly children: ReactNode;
}) {
  const steps = useLessonSteps();
  const hydrated = useHydrated();
  const closed =
    steps !== null && !lessonPartShows(steps, steps.parts.count - 1);
  return (
    <div
      className={styles["tail"]}
      data-closed={closed ? "" : undefined}
      data-hydrated={hydrated ? "" : undefined}
      data-lesson-tail
    >
      {children}
    </div>
  );
}
