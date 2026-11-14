import {
  exerciseAnswerSchema,
  exerciseKinds,
  exerciseResultSchema,
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
  exerciseStatisticsSchema,
  storedExerciseMistakesSchema,
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
  // Read per row: an answer or mistakes an older release stored in another shape still count
  // as a respondent and only drop out of the mistake tally.
  answer: z.unknown(),
  mistakes: z.unknown(),
  attempts: z.number().int().positive(),
  first_answered_at: z.date(),
});
type Row = z.infer<typeof rowSchema>;
type Mistake = NonNullable<
  ExerciseStatistics["versions"][number]["mostFrequentMistake"]
>;

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
      select exercise_id, exercise_kind, fingerprint, result, answer, mistakes,
        count(*)::int as attempts, min(attempted_at) as first_answered_at
      from exercise_attempts.attempts
      where material_id = ${parsed.data.materialId.toLowerCase()}::uuid
        and first_for_version
      group by exercise_id, exercise_kind, fingerprint, result, answer, mistakes
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
  /** Mistake counts by a canonical key, so equal mistakes add up. */
  readonly mistakes: Map<string, Mistake>;
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
      mistakes: new Map<string, Mistake>(),
    };
    versions.set(key, tally);
    tally.respondents += row.attempts;
    if (row.first_answered_at < tally.firstAnsweredAt)
      tally.firstAnsweredAt = row.first_answered_at;
    if (row.result === "correct") tally.firstTryCorrect += row.attempts;
    if (row.result === "dontKnow") tally.firstTryDontKnow += row.attempts;
    if (row.result === "incorrect")
      for (const mistake of rowMistakes(row)) {
        const counted = tally.mistakes.get(mistake.key)?.count ?? 0;
        tally.mistakes.set(mistake.key, {
          ...mistake.value,
          count: counted + mistake.value.count,
        });
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
          mostFrequentMistake: mostFrequent(tally.mistakes),
        })),
      }),
    );
}

/**
 * What one wrong first answer counts towards: a quiz its whole option set (equal sets are one
 * answer, whatever order the reader chose them in); a match each wrong row → choice pair; an
 * order each step out of place.
 */
function rowMistakes(
  row: Row,
): { readonly key: string; readonly value: Mistake }[] {
  if (row.exercise_kind === "quiz") {
    const answer = exerciseAnswerSchema.safeParse(row.answer);
    if (!answer.success || answer.data.kind !== "options") return [];
    const optionIds = [...answer.data.optionIds].sort(compareText);
    return [
      {
        key: `options|${optionIds.join(",")}`,
        value: { kind: "options", optionIds, count: row.attempts },
      },
    ];
  }
  const mistakes = storedExerciseMistakesSchema.safeParse(row.mistakes);
  if (!mistakes.success) return [];
  return mistakes.data.kind === "pairs"
    ? mistakes.data.pairs.map((pair) => ({
        key: `pair|${pair.rowId}|${pair.choiceId}`,
        value: {
          kind: "pair",
          rowId: pair.rowId,
          choiceId: pair.choiceId,
          count: row.attempts,
        },
      }))
    : mistakes.data.stepIds.map((stepId) => ({
        key: `step|${stepId}`,
        value: { kind: "step", stepId, count: row.attempts },
      }));
}

function byFirstAnswer(left: VersionTally, right: VersionTally): number {
  const byTime =
    left.firstAnsweredAt.getTime() - right.firstAnsweredAt.getTime();
  return byTime === 0
    ? compareText(left.fingerprint, right.fingerprint)
    : byTime;
}

/** The most frequent mistake; a tie goes to the smaller canonical key, so it is stable. */
function mostFrequent(mistakes: ReadonlyMap<string, Mistake>): Mistake | null {
  let best: { key: string; mistake: Mistake } | null = null;
  for (const [key, mistake] of mistakes)
    if (
      best === null ||
      mistake.count > best.mistake.count ||
      (mistake.count === best.mistake.count && compareText(key, best.key) < 0)
    )
      best = { key, mistake };
  return best?.mistake ?? null;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
