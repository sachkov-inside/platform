import {
  exerciseAnswerSchema,
  exerciseIdSchema,
  exerciseResultSchema,
} from "@inside/material-blocks";
import { z } from "zod";

import type { StoredExerciseAnswer } from "./lesson-exercises";

/** The part of `localStorage` guest answers use; tests and blocked storage supply their own. */
export type GuestAnswerStorage = Pick<Storage, "getItem" | "setItem">;

const storedSchema = z.record(
  exerciseIdSchema,
  z
    .object({
      answer: exerciseAnswerSchema,
      result: exerciseResultSchema,
      fingerprint: z.string().regex(/^[0-9a-f]{16}$/u),
    })
    .strict(),
);

/** One lesson's guest answers live under this browser storage key. */
export function guestAnswersKey(materialId: string): string {
  return `inside.exercise-answers.v1:${materialId}`;
}

/** Stored guest answers; a damaged or foreign value reads as no answers. */
export function parseGuestAnswers(
  raw: string | null,
): Map<string, StoredExerciseAnswer> {
  try {
    const parsed = storedSchema.safeParse(JSON.parse(raw ?? "{}"));
    return new Map<string, StoredExerciseAnswer>(
      parsed.success ? Object.entries(parsed.data) : [],
    );
  } catch {
    // Not JSON: the guest starts without past answers.
    return new Map<string, StoredExerciseAnswer>();
  }
}

/**
 * A guest's answers to one lesson, kept only in this browser: the latest answer per exercise.
 * They never reach the server and are not moved to an Account after sign-in (spec section 2).
 */
export function guestExerciseAnswers(
  storage: GuestAnswerStorage,
  materialId: string,
) {
  const key = guestAnswersKey(materialId);
  const read = (): Map<string, StoredExerciseAnswer> => {
    try {
      return parseGuestAnswers(storage.getItem(key));
    } catch {
      // Blocked storage: the guest starts without past answers.
      return new Map<string, StoredExerciseAnswer>();
    }
  };
  return {
    read,
    save(exerciseId: string, answer: StoredExerciseAnswer): void {
      try {
        storage.setItem(
          key,
          JSON.stringify(
            Object.fromEntries(read().set(exerciseId, answer).entries()),
          ),
        );
      } catch {
        // Answering still works when the browser blocks or fills storage.
      }
    },
  };
}
