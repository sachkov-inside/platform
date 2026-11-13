import { randomUUID } from "node:crypto";
import {
  checkExerciseAnswer,
  exerciseAnswerSchema,
  exerciseFingerprint,
  exerciseIdSchema,
  materialExercises,
  type RenderedExercise,
} from "@inside/material-blocks";
import { z } from "zod";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import type { ExerciseAttemptsPrismaClient } from "../../../../infrastructure/prisma/index.js";
import { accountId } from "../../../accounts/index.js";
import type { ContentAccess } from "../../../content-access/index.js";
import {
  materialId,
  type MaterialContent,
  type materialBodyOperations,
} from "../../../materials/index.js";
import type {
  RecordExerciseAttemptCommand,
  RecordExerciseAttemptResult,
} from "./record-exercise-attempt.contract.js";

const commandSchema = z
  .object({
    accountId: z.uuid(),
    materialId: z.uuid(),
    exerciseId: exerciseIdSchema,
    answer: exerciseAnswerSchema,
  })
  .strict();

/** A Save between the access decision and the body read moves the version; read once more. */
const MAX_READ_ATTEMPTS = 2;

export interface RecordExerciseAttemptDependencies {
  readonly prisma: ExerciseAttemptsPrismaClient;
  readonly contentAccess: Pick<ContentAccess, "authorize">;
  readonly materialContent: Pick<MaterialContent, "loadPublishedBody">;
  readonly materialBodyOperations: Pick<
    typeof materialBodyOperations,
    "render"
  >;
}

/**
 * Checks a reader's answer against the published exercise and records the attempt. The server
 * owns the result and the version: the request names only the exercise and the answer. The
 * first attempt of an Account on an exercise version is marked; the partial unique index keeps
 * it single under concurrent checks. An attempt changes no access, progress or Product Task.
 */
export async function recordExerciseAttempt(
  dependencies: RecordExerciseAttemptDependencies,
  input: RecordExerciseAttemptCommand,
): Promise<RecordExerciseAttemptResult> {
  const parsed = commandSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: { code: "invalid_request" } };
  const command = {
    ...parsed.data,
    accountId: parsed.data.accountId.toLowerCase(),
    materialId: parsed.data.materialId.toLowerCase(),
  };
  try {
    const exercise = await publishedExercise(dependencies, command);
    if (!exercise.ok) return exercise;
    const result = checkExerciseAnswer(exercise.value, command.answer);
    if (result === undefined)
      return { ok: false, error: { code: "answer_mismatch" } };
    const fingerprint = exerciseFingerprint(exercise.value);
    const attemptedAt = new Date();
    const row = {
      accountId: command.accountId,
      materialId: command.materialId,
      exerciseId: command.exerciseId,
      exerciseKind: exercise.value.kind,
      fingerprint,
      answer: command.answer,
      result,
      attemptedAt,
    };
    // `exercise_attempts_one_first` admits one first attempt per Account and version; a lost
    // race skips the row and the attempt is recorded as a later one.
    const first = await dependencies.prisma.exerciseAttempt.createMany({
      data: [{ ...row, id: randomUUID(), firstForVersion: true }],
      skipDuplicates: true,
    });
    if (first.count === 0)
      await dependencies.prisma.exerciseAttempt.create({
        data: { ...row, id: randomUUID(), firstForVersion: false },
      });
    return {
      ok: true,
      value: {
        exerciseId: command.exerciseId,
        fingerprint,
        answer: command.answer,
        result,
        firstForVersion: first.count === 1,
        attemptedAt: attemptedAt.toISOString(),
      },
    };
  } catch (error) {
    return dependencyFailure(
      { module: "exercise-attempts", operation: "recordExerciseAttempt" },
      error,
      { ok: false, error: { code: "dependency_unavailable" } },
    );
  }
}

type ExerciseLookup =
  | { readonly ok: true; readonly value: RenderedExercise }
  | {
      readonly ok: false;
      readonly error:
        | { readonly code: "access_denied" }
        | { readonly code: "exercise_not_found" }
        | { readonly code: "dependency_unavailable" };
    };

/** The exercise in the body version the reader may read now. */
async function publishedExercise(
  dependencies: RecordExerciseAttemptDependencies,
  command: {
    readonly accountId: string;
    readonly materialId: string;
    readonly exerciseId: string;
  },
): Promise<ExerciseLookup> {
  for (let attempt = 0; attempt < MAX_READ_ATTEMPTS; attempt += 1) {
    const decision = await dependencies.contentAccess.authorize({
      subject: { kind: "account", accountId: accountId(command.accountId) },
      action: "read",
      resource: {
        kind: "material",
        materialId: materialId(command.materialId),
      },
      enforcementPoint: "exercise_attempt",
      correlationId: randomUUID(),
    });
    if (decision.effect === "deny")
      return {
        ok: false,
        error: {
          code:
            decision.reason === "dependency_unavailable"
              ? "dependency_unavailable"
              : decision.reason === "resource_not_found" ||
                  decision.reason === "resource_unpublished"
                ? "exercise_not_found"
                : "access_denied",
        },
      };
    const body = await dependencies.materialContent.loadPublishedBody({
      materialId: materialId(command.materialId),
      checkedContentVersion: decision.checkedContentVersion,
    });
    if (!body.ok)
      return { ok: false, error: { code: "dependency_unavailable" } };
    if (body.value === null) continue;
    const rendered = dependencies.materialBodyOperations.render(body.value);
    if (!rendered.ok)
      return { ok: false, error: { code: "dependency_unavailable" } };
    const exercise = materialExercises(rendered.value.blocks).find(
      (candidate) => candidate.id === command.exerciseId,
    );
    return exercise === undefined
      ? { ok: false, error: { code: "exercise_not_found" } }
      : { ok: true, value: exercise };
  }
  return { ok: false, error: { code: "dependency_unavailable" } };
}
