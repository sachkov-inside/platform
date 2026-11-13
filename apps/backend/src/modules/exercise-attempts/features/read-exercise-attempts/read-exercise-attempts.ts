import { z } from "zod";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import {
  Prisma,
  type ExerciseAttemptsPrismaClient,
} from "../../../../infrastructure/prisma/index.js";
import {
  exerciseAttemptSchema,
  type ExerciseAttempt,
} from "../../domain/exercise-attempt.js";

export type ReadExerciseAttemptsResult =
  | { readonly ok: true; readonly value: readonly ExerciseAttempt[] }
  | {
      readonly ok: false;
      readonly error:
        | { readonly code: "invalid_request" }
        | { readonly code: "dependency_unavailable" };
    };

export interface ReadExerciseAttemptsQuery {
  readonly accountId: string;
  readonly materialId: string;
}

const querySchema = z
  .object({ accountId: z.uuid(), materialId: z.uuid() })
  .strict();

const rowSchema = z.object({
  exercise_id: z.string(),
  fingerprint: z.string(),
  answer: z.unknown(),
  result: z.string(),
  first_for_version: z.boolean(),
  attempted_at: z.date(),
});

/**
 * The latest attempt of the reader on each exercise of one Material, ordered by exercise id: a
 * complete list, bounded by the exercises the reader has answered. The attempt keeps the version
 * it was checked against; the reader compares it with the exercise on the page. Reading one's own
 * attempts needs no access to the Material: they are the reader's own facts.
 */
export async function readExerciseAttempts(
  prisma: ExerciseAttemptsPrismaClient,
  input: ReadExerciseAttemptsQuery,
): Promise<ReadExerciseAttemptsResult> {
  const parsed = querySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: { code: "invalid_request" } };
  try {
    const rows: unknown = await prisma.$queryRaw(Prisma.sql`
      select distinct on (exercise_id)
        exercise_id, fingerprint, answer, result, first_for_version, attempted_at
      from exercise_attempts.attempts
      where account_id = ${parsed.data.accountId.toLowerCase()}::uuid
        and material_id = ${parsed.data.materialId.toLowerCase()}::uuid
      order by exercise_id, sequence desc
    `);
    return {
      ok: true,
      value: z
        .array(rowSchema)
        .parse(rows)
        .map((row) =>
          exerciseAttemptSchema.parse({
            exerciseId: row.exercise_id,
            fingerprint: row.fingerprint,
            answer: row.answer,
            result: row.result,
            firstForVersion: row.first_for_version,
            attemptedAt: row.attempted_at.toISOString(),
          }),
        ),
    };
  } catch (error) {
    return dependencyFailure(
      { module: "exercise-attempts", operation: "readExerciseAttempts" },
      error,
      { ok: false, error: { code: "dependency_unavailable" } },
    );
  }
}
