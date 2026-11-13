"use client";

import type { Route } from "next";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import {
  ExerciseAnswersProvider,
  useMaterialReading,
  type ExerciseAnswerRecord,
  type ExerciseAnswerState,
} from "@/entities/material";
import { useAnnouncedRefresh } from "@/shared/api/use-announced-refresh.client";

import {
  exerciseAttemptsQueryOptions,
  recordExerciseAttempt,
} from "../api/exercise-attempts.browser";
import { exerciseAttemptChanges } from "../model/exercise-attempt-events";
import {
  guestAnswersKey,
  guestExerciseAnswers,
  parseGuestAnswers,
} from "../model/guest-exercise-answers";
import {
  exerciseAnswerView,
  lessonExerciseSummary,
  type LessonExercise,
  type StoredExerciseAnswer,
} from "../model/lesson-exercises";
import { LessonExerciseSummary } from "./lesson-exercise-summary";

type LessonAnswers = (exerciseId: string) => ExerciseAnswerState;

/** Another tab of this browser may answer the same lesson. */
function subscribeStorage(listener: () => void): () => void {
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener("storage", listener);
  };
}

function readStoredGuestAnswers(materialId: string): string | null {
  try {
    return window.localStorage.getItem(guestAnswersKey(materialId));
  } catch {
    // Blocked storage reads as no past answers.
    return null;
  }
}

const LessonAnswersContext = createContext<LessonAnswers | null>(null);
const LessonSummaryContext = createContext<ReturnType<
  typeof lessonExerciseSummary
> | null>(null);

/** The answer source of a lesson: one hook for every exercise, fed by the scope below. */
function useLessonExerciseAnswer(exerciseId: string): ExerciseAnswerState {
  const answers = useContext(LessonAnswersContext);
  if (answers === null)
    throw new Error("LessonExerciseAttempts must wrap the lesson exercises");
  return answers(exerciseId);
}

/**
 * Exercise Attempts of one open lesson. A signed-in reader's answers are checked and recorded by
 * the server and come back when the lesson opens again; a guest's stay in this browser, with an
 * offer to sign in under each exercise, and are not moved to the Account after sign-in.
 * `SavedLessonExerciseSummary` inside the wrapped content shows «Упражнения: N из M решены».
 * Attempts change neither «Изучено» nor course progress.
 */
export function LessonExerciseAttempts({
  materialId,
  exercises,
  signInHref,
  children,
}: {
  readonly materialId: string;
  readonly exercises: readonly LessonExercise[];
  readonly signInHref: Route;
  readonly children: ReactNode;
}) {
  const { accountId, resolved } = useMaterialReading();
  const reader = !resolved
    ? "pending"
    : accountId === null
      ? "guest"
      : "account";
  const queryClient = useQueryClient();
  const options = exerciseAttemptsQueryOptions({
    accountId: reader === "account" ? accountId : null,
    materialId,
  });
  const saved = useQuery(options);
  const changes = useMemo(
    () =>
      reader === "account" && accountId !== null
        ? exerciseAttemptChanges(accountId)
        : null,
    [accountId, reader],
  );
  useAnnouncedRefresh(changes, ["exercise-attempts", accountId]);
  // The server render and hydration show no guest answers; browser storage is read after them.
  const guestRaw = useSyncExternalStore(
    subscribeStorage,
    () => (reader === "guest" ? readStoredGuestAnswers(materialId) : null),
    () => null,
  );
  const guestAnswers = useMemo(() => parseGuestAnswers(guestRaw), [guestRaw]);
  // Answers given on this page, shown at once; the server's result replaces each when it arrives.
  const [given, setGiven] = useState<ReadonlyMap<string, StoredExerciseAnswer>>(
    new Map(),
  );
  // «Ответить ещё раз» hides the shown answer; the recorded attempt stays.
  const [cleared, setCleared] = useState<ReadonlySet<string>>(new Set());
  const [unsaved, setUnsaved] = useState<ReadonlySet<string>>(new Set());
  // Answers given before the shell knew the reader; they are saved once it does.
  const waiting = useRef(new Map<string, StoredExerciseAnswer>());

  const record = useMutation({
    mutationKey: ["exercise-attempts", accountId, materialId, "record"],
    mutationFn: recordExerciseAttempt,
    onSuccess: (result, input) => {
      if (result.kind !== "ready") {
        setUnsaved((previous) => new Set(previous).add(input.exerciseId));
        return;
      }
      const { attempt } = result;
      setGiven((previous) =>
        new Map(previous).set(attempt.exerciseId, {
          answer: attempt.answer,
          result: attempt.result,
          fingerprint: attempt.fingerprint,
        }),
      );
      queryClient.setQueryData(options.queryKey, (previous) => ({
        kind: "ready" as const,
        attempts: [
          ...(previous?.kind === "ready"
            ? previous.attempts.filter(
                (item) => item.exerciseId !== attempt.exerciseId,
              )
            : []),
          attempt,
        ],
      }));
      changes?.announce();
    },
    onError: (_error, input) => {
      setUnsaved((previous) => new Set(previous).add(input.exerciseId));
    },
  });

  const { mutate } = record;
  /** Keeps a checked answer where this reader's answers live. */
  const persist = useCallback(
    (exerciseId: string, stored: StoredExerciseAnswer) => {
      if (reader === "guest")
        guestExerciseAnswers(localStorage, materialId).save(exerciseId, stored);
      else mutate({ materialId, exerciseId, answer: stored.answer });
    },
    [materialId, mutate, reader],
  );
  useEffect(() => {
    if (reader === "pending") return;
    const held = [...waiting.current];
    waiting.current.clear();
    for (const [exerciseId, stored] of held) persist(exerciseId, stored);
  }, [persist, reader]);

  const base: ReadonlyMap<string, StoredExerciseAnswer> =
    reader === "guest"
      ? guestAnswers
      : saved.data?.kind === "ready"
        ? new Map(
            saved.data.attempts.map((attempt) => [
              attempt.exerciseId,
              {
                answer: attempt.answer,
                result: attempt.result,
                fingerprint: attempt.fingerprint,
              },
            ]),
          )
        : new Map();
  const answers = new Map([...base, ...given]);
  const byId = new Map(exercises.map((exercise) => [exercise.id, exercise]));

  const guestNote = (
    <p>
      <Link
        className="text-foreground underline underline-offset-4"
        href={signInHref}
      >
        Войдите
      </Link>
      , чтобы ответы сохранялись в аккаунте. Сейчас они хранятся только в этом
      браузере.
    </p>
  );

  const source: LessonAnswers = (exerciseId) => {
    const exercise = byId.get(exerciseId);
    const view =
      exercise === undefined || cleared.has(exerciseId)
        ? { current: null, updated: false }
        : exerciseAnswerView(exercise, answers.get(exerciseId));
    const note =
      reader === "guest" ? (
        guestNote
      ) : unsaved.has(exerciseId) ? (
        <p role="status">Не удалось сохранить ответ. Попробуйте ещё раз.</p>
      ) : undefined;
    return {
      ...view,
      ...(note === undefined ? {} : { note }),
      answer: (checked: ExerciseAnswerRecord) => {
        if (exercise === undefined) return;
        const stored = { ...checked, fingerprint: exercise.fingerprint };
        setGiven((previous) => new Map(previous).set(exerciseId, stored));
        setCleared((previous) => {
          const next = new Set(previous);
          next.delete(exerciseId);
          return next;
        });
        setUnsaved((previous) => {
          const next = new Set(previous);
          next.delete(exerciseId);
          return next;
        });
        if (reader === "pending") waiting.current.set(exerciseId, stored);
        else persist(exerciseId, stored);
      },
      retry: () => {
        setCleared((previous) => new Set(previous).add(exerciseId));
      },
    };
  };

  return (
    <LessonAnswersContext value={source}>
      <LessonSummaryContext value={lessonExerciseSummary(exercises, answers)}>
        <ExerciseAnswersProvider source={useLessonExerciseAnswer}>
          {children}
        </ExerciseAnswersProvider>
      </LessonSummaryContext>
    </LessonAnswersContext>
  );
}

/** «Упражнения: N из M решены» of the lesson around it; nothing outside `LessonExerciseAttempts`. */
export function SavedLessonExerciseSummary() {
  const summary = useContext(LessonSummaryContext);
  return summary === null ? null : <LessonExerciseSummary {...summary} />;
}
