import { z } from "zod";
import { exerciseIdSchema } from "./exercise-rules.js";

/**
 * What a reader answered to one Lesson Exercise (an Exercise Attempt stores it as is):
 * - `options`: the chosen quiz options;
 * - `matches`: the choice picked for each «Сопоставь» row;
 * - `sequence`: the «Расставь по порядку» steps in the order the reader put them;
 * - `dontKnow`: «Не знаю», offered only where the author wrote it.
 * Bounds follow the exercise limits: at most 8 options or steps, at most 6 rows.
 */
export const exerciseAnswerSchema: z.ZodDiscriminatedUnion<
  [
    z.ZodObject<
      { kind: z.ZodLiteral<"options">; optionIds: z.ZodArray<z.ZodString> },
      z.core.$strict
    >,
    z.ZodObject<
      {
        kind: z.ZodLiteral<"matches">;
        matches: z.ZodArray<
          z.ZodObject<
            { rowId: z.ZodString; choiceId: z.ZodString },
            z.core.$strict
          >
        >;
      },
      z.core.$strict
    >,
    z.ZodObject<
      { kind: z.ZodLiteral<"sequence">; stepIds: z.ZodArray<z.ZodString> },
      z.core.$strict
    >,
    z.ZodObject<{ kind: z.ZodLiteral<"dontKnow"> }, z.core.$strict>,
  ],
  "kind"
> = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("options"),
      optionIds: z.array(exerciseIdSchema).min(1).max(8),
    })
    .strict(),
  z
    .object({
      kind: z.literal("matches"),
      matches: z
        .array(
          z
            .object({ rowId: exerciseIdSchema, choiceId: exerciseIdSchema })
            .strict(),
        )
        .min(1)
        .max(6),
    })
    .strict(),
  z
    .object({
      kind: z.literal("sequence"),
      stepIds: z.array(exerciseIdSchema).min(1).max(8),
    })
    .strict(),
  z.object({ kind: z.literal("dontKnow") }).strict(),
]);
export type ExerciseAnswer = z.infer<typeof exerciseAnswerSchema>;

/** «Не знаю» is its own result: neither right nor wrong. */
export const exerciseResultSchema: z.ZodEnum<{
  correct: "correct";
  incorrect: "incorrect";
  dontKnow: "dontKnow";
}> = z.enum(["correct", "incorrect", "dontKnow"]);
export type ExerciseResult = z.infer<typeof exerciseResultSchema>;

/**
 * The part of an exercise that decides answers: its items and the key. A rendered exercise
 * (`RenderedExercise`) fits it as is; wording, explanations and context are not part of it.
 */
export type ExerciseKey =
  | {
      readonly kind: "quiz";
      readonly selectionMode: "single" | "multiple";
      readonly options: readonly {
        readonly id: string;
        readonly correct: boolean;
      }[];
      readonly dontKnow?: unknown;
    }
  | {
      readonly kind: "match";
      readonly mode: "pairs" | "groups";
      readonly rows: readonly {
        readonly id: string;
        readonly answerId: string;
      }[];
      readonly choices: readonly { readonly id: string }[];
      readonly dontKnow?: unknown;
    }
  | {
      readonly kind: "order";
      readonly steps: readonly { readonly id: string }[];
      readonly dontKnow?: unknown;
    };

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  const set = new Set(left);
  return (
    set.size === left.length &&
    left.length === right.length &&
    right.every((id) => set.has(id))
  );
}

/**
 * The result of an answer, or undefined when the answer does not fit the exercise: another kind,
 * an unknown or repeated item, an incomplete match or order, several options for a single choice,
 * or «Не знаю» where the author did not offer it.
 */
export function checkExerciseAnswer(
  exercise: ExerciseKey,
  answer: ExerciseAnswer,
): ExerciseResult | undefined {
  if (answer.kind === "dontKnow")
    return exercise.dontKnow === undefined ? undefined : "dontKnow";
  switch (exercise.kind) {
    case "quiz": {
      if (answer.kind !== "options") return undefined;
      const known = new Set(exercise.options.map((option) => option.id));
      const chosen = new Set(answer.optionIds);
      if (
        chosen.size !== answer.optionIds.length ||
        answer.optionIds.some((id) => !known.has(id)) ||
        (exercise.selectionMode === "single" && chosen.size !== 1)
      )
        return undefined;
      const correct = exercise.options
        .filter((option) => option.correct)
        .map((option) => option.id);
      return sameSet(answer.optionIds, correct) ? "correct" : "incorrect";
    }
    case "match": {
      if (answer.kind !== "matches") return undefined;
      const choices = new Set(exercise.choices.map((choice) => choice.id));
      if (
        !sameSet(
          answer.matches.map((match) => match.rowId),
          exercise.rows.map((row) => row.id),
        ) ||
        answer.matches.some((match) => !choices.has(match.choiceId))
      )
        return undefined;
      const key = new Map(exercise.rows.map((row) => [row.id, row.answerId]));
      return answer.matches.every(
        (match) => key.get(match.rowId) === match.choiceId,
      )
        ? "correct"
        : "incorrect";
    }
    case "order": {
      if (answer.kind !== "sequence") return undefined;
      const steps = exercise.steps.map((step) => step.id);
      if (!sameSet(answer.stepIds, steps)) return undefined;
      return answer.stepIds.every((id, index) => id === steps[index])
        ? "correct"
        : "incorrect";
    }
  }
}

/**
 * The canonical text of an exercise version: items and the key, nothing else. Quiz options,
 * match rows and choices are sorted, because their order is presentation; order steps keep
 * their sequence, because it is the key.
 */
function exerciseVersionText(exercise: ExerciseKey): string {
  const sorted = (values: readonly string[]) => [...values].sort().join(",");
  switch (exercise.kind) {
    case "quiz":
      return `quiz|${sorted(
        exercise.options.map(
          (option) => `${option.id}${option.correct ? "+" : "-"}`,
        ),
      )}`;
    case "match":
      return `match|${exercise.mode}|${sorted(
        exercise.rows.map((row) => `${row.id}=${row.answerId}`),
      )}|${sorted(exercise.choices.map((choice) => choice.id))}`;
    case "order":
      return `order|${exercise.steps.map((step) => step.id).join(",")}`;
  }
}

/** UTF-8 bytes of a text; the package runs without DOM or Node globals such as `TextEncoder`. */
function utf8(text: string): number[] {
  const bytes: number[] = [];
  for (const symbol of text) {
    const point = symbol.codePointAt(0) ?? 0;
    if (point < 0x80) bytes.push(point);
    else if (point < 0x800)
      bytes.push(0xc0 | (point >> 6), 0x80 | (point & 63));
    else if (point < 0x10000)
      bytes.push(
        0xe0 | (point >> 12),
        0x80 | ((point >> 6) & 63),
        0x80 | (point & 63),
      );
    else
      bytes.push(
        0xf0 | (point >> 18),
        0x80 | ((point >> 12) & 63),
        0x80 | ((point >> 6) & 63),
        0x80 | (point & 63),
      );
  }
  return bytes;
}

const fnvOffset = 0xcbf29ce484222325n;
const fnvPrime = 0x100000001b3n;
const mask64 = 0xffffffffffffffffn;

/**
 * The version of an exercise: 64-bit FNV-1a of its canonical text over UTF-8, as 16 hex digits.
 * Attempts carry it, so a reworded exercise keeps its version and changed options, rows, steps
 * or key start a new one. It tells versions of one exercise apart; it is no security token, and
 * the server recomputes it from the published body for every attempt.
 */
export function exerciseFingerprint(exercise: ExerciseKey): string {
  let hash = fnvOffset;
  for (const byte of utf8(exerciseVersionText(exercise))) {
    hash ^= BigInt(byte);
    hash = (hash * fnvPrime) & mask64;
  }
  return hash.toString(16).padStart(16, "0");
}
