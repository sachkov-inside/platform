import { z } from "zod";

/** Lesson Exercise kinds, in the order the wire contract enumerates them. */
export const exerciseKinds = ["quiz", "match", "order"] as const;
export type ExerciseKind = (typeof exerciseKinds)[number];

export function isExerciseKind(kind: string): kind is ExerciseKind {
  return (exerciseKinds as readonly string[]).includes(kind);
}

/**
 * The author's identifier of an exercise and of its options, rows, choices and steps. Attempts
 * are bound to it, so it survives republication; Content checks the same pattern (#86).
 */
export const exerciseIdSchema: z.ZodString = z
  .string()
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u, "Expected a lowercase kebab-case id");

/** `after-answer` hides the text below the exercise until the first answer (#2122). */
export const exerciseRevealSchema: z.ZodEnum<{
  none: "none";
  "after-answer": "after-answer";
}> = z.enum(["none", "after-answer"]);

/**
 * The answer structure of an exercise, the same whether its texts are Markdown from a package or
 * rendered blocks of a stored document. `explained` says whether the item carries an explanation.
 */
export type ExerciseStructure =
  | {
      readonly kind: "quiz";
      readonly selectionMode: "single" | "multiple";
      readonly options: readonly {
        readonly id: string;
        readonly correct: boolean;
        readonly explained: boolean;
      }[];
    }
  | {
      readonly kind: "match";
      readonly mode: "pairs" | "groups";
      readonly rows: readonly {
        readonly id: string;
        readonly answerId: string;
      }[];
      readonly choices: readonly { readonly id: string }[];
    }
  | {
      readonly kind: "order";
      readonly steps: readonly { readonly id: string }[];
    };

function within(count: number, min: number, max: number): boolean {
  return count >= min && count <= max;
}

/**
 * The first rule the exercise breaks, or undefined. The limits match the Content exporter (#86):
 * a quiz has 2–5 options (2–8 with several correct ones), at least one correct and one wrong, and
 * an explanation on every wrong option; a match has 3–6 rows, pairs answer one to one, groups
 * use 2–3 groups, all of them, one holding several rows; an order has 3–8 steps.
 */
export function exerciseStructureIssue(
  exercise: ExerciseStructure,
): string | undefined {
  const ids: string[] = [];
  switch (exercise.kind) {
    case "quiz": {
      const correct = exercise.options.filter((option) => option.correct);
      ids.push(...exercise.options.map((option) => option.id));
      if (correct.length === 0 || correct.length === exercise.options.length)
        return "A quiz needs at least one correct and one wrong option";
      if (
        exercise.selectionMode !== (correct.length > 1 ? "multiple" : "single")
      )
        return "selectionMode must be multiple exactly when several options are correct";
      if (
        !within(
          exercise.options.length,
          2,
          exercise.selectionMode === "multiple" ? 8 : 5,
        )
      )
        return "Too few or too many quiz options";
      if (
        exercise.options.some((option) => !option.correct && !option.explained)
      )
        return "A wrong quiz option needs an explanation";
      break;
    }
    case "match": {
      const choices = exercise.choices.map((choice) => choice.id);
      const answers = exercise.rows.map((row) => row.answerId);
      ids.push(...exercise.rows.map((row) => row.id), ...choices);
      if (!within(exercise.rows.length, 3, 6)) return "A match needs 3–6 rows";
      if (answers.some((answer) => !choices.includes(answer)))
        return "Every row answer names a choice";
      const used = new Set(answers);
      if (exercise.mode === "pairs") {
        if (choices.length !== answers.length || used.size !== answers.length)
          return "Pairs match each row to its own choice";
      } else if (
        !within(choices.length, 2, 3) ||
        used.size !== choices.length ||
        used.size === answers.length
      )
        return "Groups use 2–3 groups, each of them, one holding several rows";
      break;
    }
    case "order":
      ids.push(...exercise.steps.map((step) => step.id));
      if (!within(exercise.steps.length, 3, 8))
        return "An order needs 3–8 steps";
      break;
  }
  return new Set(ids).size === ids.length
    ? undefined
    : "Item ids repeat inside the exercise";
}
