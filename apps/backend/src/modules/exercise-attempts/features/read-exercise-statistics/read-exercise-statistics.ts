import {
  exerciseAnswerSchema,
  exerciseKinds,
  exerciseResultSchema,
  type ExerciseAnswer,
} from "@inside/material-blocks";
import { z } from "zod";
import {
  authorizeManager,
  type AuthorPolicy,
} from "../../../../infrastructure/content-authoring/author-policy.js";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import {
  Prisma,
  type ExerciseAttemptsPrismaClient,
} from "../../../../infrastructure/prisma/index.js";
import {
  canonicalExerciseAnswer,
  exerciseStatisticsSchema,
  type ExerciseStatistics,
} from "../../domain/exercise-statistics.js";

export type ReadExerciseStatisticsResult =
  | { readonly ok: true; readonly value: readonly ExerciseStatistics[] }
  | {
      readonly ok: false;
      readonly error:
        | { readonly code: "invalid_request" }
        | { readonly code: "forbidden" }
        | { readonly code: "dependency_unavailable"; readonly retryable: true };
    };

export interface ReadExerciseStatisticsQuery {
  readonly actor: string;
  readonly materialId: string;
}

export interface ReadExerciseStatisticsDependencies {
  readonly prisma: ExerciseAttemptsPrismaClient;
  readonly authorPolicy: AuthorPolicy;
}

const querySchema = z
  .object({ actor: z.uuid(), materialId: z.uuid() })
  .strict();

/** One group of identical first attempts. */
const rowSchema = z.object({
  exercise_id: z.string(),
  exercise_kind: z.enum(exerciseKinds),
  fingerprint: z.string(),
  result: exerciseResultSchema,
  answer: exerciseAnswerSchema,
  attempts: z.number().int().positive(),
  first_answered_at: z.date(),
});
type Row = z.infer<typeof rowSchema>;

/**
 * First-try statistics of every exercise version of one Material that readers answered, for an
 * Account that manages Materials. A complete list: bounded by the exercises and versions of one
 * lesson. Exercises come in identifier order; the reader of the statistics places them in the
 * lesson. An exercise removed from the lesson keeps its statistics.
 */
export async function readExerciseStatistics(
  dependencies: ReadExerciseStatisticsDependencies,
  input: ReadExerciseStatisticsQuery,
): Promise<ReadExerciseStatisticsResult> {
  const parsed = querySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: { code: "invalid_request" } };
  const authorization = await authorizeManager(
    dependencies.authorPolicy,
    parsed.data.actor,
  );
  if (!authorization.ok) return authorization;
  try {
    // `exercise_attempts_first_by_version` serves this read.
    const rows: unknown = await dependencies.prisma.$queryRaw(Prisma.sql`
      select exercise_id, exercise_kind, fingerprint, result, answer,
        count(*)::int as attempts, min(attempted_at) as first_answered_at
      from exercise_attempts.attempts
      where material_id = ${parsed.data.materialId.toLowerCase()}::uuid
        and first_for_version
      group by exercise_id, exercise_kind, fingerprint, result, answer
    `);
    return {
      ok: true,
      value: exerciseStatistics(z.array(rowSchema).parse(rows)),
    };
  } catch (error) {
    return dependencyFailure(
      { module: "exercise-attempts", operation: "readExerciseStatistics" },
      error,
      {
        ok: false,
        error: { code: "dependency_unavailable", retryable: true },
      },
    );
  }
}

interface VersionTally {
  readonly kind: Row["exercise_kind"];
  readonly exerciseId: string;
  readonly fingerprint: string;
  firstAnsweredAt: Date;
  respondents: number;
  firstTryCorrect: number;
  firstTryDontKnow: number;
  readonly wrong: Map<string, { answer: ExerciseAnswer; count: number }>;
}

function exerciseStatistics(rows: readonly Row[]): ExerciseStatistics[] {
  const versions = new Map<string, VersionTally>();
  for (const row of rows) {
    const key = `${row.exercise_id}|${row.fingerprint}`;
    const tally = versions.get(key) ?? {
      kind: row.exercise_kind,
      exerciseId: row.exercise_id,
      fingerprint: row.fingerprint,
      firstAnsweredAt: row.first_answered_at,
      respondents: 0,
      firstTryCorrect: 0,
      firstTryDontKnow: 0,
      wrong: new Map(),
    };
    versions.set(key, tally);
    tally.respondents += row.attempts;
    if (row.first_answered_at < tally.firstAnsweredAt)
      tally.firstAnsweredAt = row.first_answered_at;
    if (row.result === "correct") tally.firstTryCorrect += row.attempts;
    if (row.result === "dontKnow") tally.firstTryDontKnow += row.attempts;
    if (row.result === "incorrect") {
      // Stored answers keep the reader's order; equal sets are one answer.
      const answer = canonicalExerciseAnswer(row.answer);
      const answerKey = JSON.stringify(answer);
      const wrong = tally.wrong.get(answerKey) ?? { answer, count: 0 };
      wrong.count += row.attempts;
      tally.wrong.set(answerKey, wrong);
    }
  }
  const exercises = new Map<string, VersionTally[]>();
  for (const tally of versions.values())
    exercises.set(tally.exerciseId, [
      ...(exercises.get(tally.exerciseId) ?? []),
      tally,
    ]);
  return [...exercises.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .map(([exerciseId, tallies]) =>
      exerciseStatisticsSchema.parse({
        exerciseId,
        // A version records the kind it was checked as; the newest one names the exercise.
        kind: [...tallies].sort(byFirstAnswer).at(-1)?.kind,
        versions: [...tallies].sort(byFirstAnswer).map((tally) => ({
          fingerprint: tally.fingerprint,
          firstAnsweredAt: tally.firstAnsweredAt.toISOString(),
          respondents: tally.respondents,
          firstTryCorrect: tally.firstTryCorrect,
          firstTryDontKnow: tally.firstTryDontKnow,
          mostFrequentWrongAnswer: mostFrequent(tally.wrong),
        })),
      }),
    );
}

function byFirstAnswer(left: VersionTally, right: VersionTally): number {
  return (
    left.firstAnsweredAt.getTime() - right.firstAnsweredAt.getTime() ||
    compareText(left.fingerprint, right.fingerprint)
  );
}

/** The most frequent wrong answer; a tie goes to the smaller canonical text, so it is stable. */
function mostFrequent(
  wrong: ReadonlyMap<string, { answer: ExerciseAnswer; count: number }>,
): { answer: ExerciseAnswer; count: number } | null {
  let best: { key: string; answer: ExerciseAnswer; count: number } | null =
    null;
  for (const [key, entry] of wrong)
    if (
      best === null ||
      entry.count > best.count ||
      (entry.count === best.count && compareText(key, best.key) < 0)
    )
      best = { key, answer: entry.answer, count: entry.count };
  return best === null ? null : { answer: best.answer, count: best.count };
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
