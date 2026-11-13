import type { ExerciseAttempt } from "../../domain/exercise-attempt.js";

export type RecordExerciseAttemptError =
  | { readonly code: "invalid_request" }
  | { readonly code: "access_denied" }
  | { readonly code: "exercise_not_found" }
  | { readonly code: "answer_mismatch" }
  | { readonly code: "dependency_unavailable" };
export type RecordExerciseAttemptResult =
  | { readonly ok: true; readonly value: ExerciseAttempt }
  | { readonly ok: false; readonly error: RecordExerciseAttemptError };

/** `answer` is unvalidated input; the Account comes from the authenticated session. */
export interface RecordExerciseAttemptCommand {
  readonly accountId: string;
  readonly materialId: string;
  readonly exerciseId: string;
  readonly answer: unknown;
}
