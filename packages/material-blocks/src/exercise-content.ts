import { z } from "zod";

import {
  exerciseIdSchema,
  exerciseRevealSchema,
  exerciseStructureIssue,
  type ExerciseStructure,
} from "./exercise-rules.js";

interface ExerciseContentCommon {
  readonly id: string;
  readonly reveal: "none" | "after-answer";
  readonly contextMarkdown?: string | undefined;
  readonly questionMarkdown: string;
  readonly dontKnow?:
    | {
        readonly explanationMarkdown: string;
        readonly reviewLinks: readonly string[];
      }
    | undefined;
}

export interface QuizContent extends ExerciseContentCommon {
  readonly kind: "quiz";
  readonly selectionMode: "single" | "multiple";
  readonly options: readonly {
    readonly id: string;
    readonly markdown: string;
    readonly correct: boolean;
    readonly explanationMarkdown?: string | undefined;
  }[];
}

export interface MatchContent extends ExerciseContentCommon {
  readonly kind: "match";
  readonly mode: "pairs" | "groups";
  readonly rows: readonly {
    readonly id: string;
    readonly markdown: string;
    readonly answerId: string;
    readonly explanationMarkdown: string;
  }[];
  readonly choices: readonly {
    readonly id: string;
    readonly markdown: string;
  }[];
}

export interface OrderContent extends ExerciseContentCommon {
  readonly kind: "order";
  readonly steps: readonly {
    readonly id: string;
    readonly markdown: string;
    readonly explanationMarkdown: string;
  }[];
}

/** A Lesson Exercise as the Content package carries it (`exercise-v1`, content-studio#86). */
export type ExerciseContent = QuizContent | MatchContent | OrderContent;

/** One element of a package Material's `readerBlocks`. */
export type ContentReaderBlock =
  | { readonly kind: "markdown"; readonly markdown: string }
  | ExerciseContent
  | { readonly kind: "step-break"; readonly label: string };

const text = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, "Expected nonblank text");

function common() {
  return {
    id: exerciseIdSchema,
    reveal: exerciseRevealSchema,
    contextMarkdown: text.optional(),
    questionMarkdown: text,
    dontKnow: z
      .object({
        explanationMarkdown: text,
        reviewLinks: z
          .array(
            text.refine(
              (value) => value.startsWith("#") && value.length > 1,
              "Expected same-material heading anchor",
            ),
          )
          .min(1),
      })
      .strict()
      .optional(),
  };
}

function blockSchema(): z.ZodType<ContentReaderBlock> {
  return z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("markdown"), markdown: z.string() }).strict(),
    z
      .object({
        kind: z.literal("quiz"),
        ...common(),
        selectionMode: z.enum(["single", "multiple"]),
        options: z.array(
          z
            .object({
              id: exerciseIdSchema,
              markdown: text,
              correct: z.boolean(),
              explanationMarkdown: text.optional(),
            })
            .strict(),
        ),
      })
      .strict(),
    z
      .object({
        kind: z.literal("match"),
        ...common(),
        mode: z.enum(["pairs", "groups"]),
        rows: z.array(
          z
            .object({
              id: exerciseIdSchema,
              markdown: text,
              answerId: exerciseIdSchema,
              explanationMarkdown: text,
            })
            .strict(),
        ),
        choices: z.array(
          z.object({ id: exerciseIdSchema, markdown: text }).strict(),
        ),
      })
      .strict(),
    z
      .object({
        kind: z.literal("order"),
        ...common(),
        steps: z.array(
          z
            .object({
              id: exerciseIdSchema,
              markdown: text,
              explanationMarkdown: text,
            })
            .strict(),
        ),
      })
      .strict(),
    z
      .object({
        kind: z.literal("step-break"),
        label: text.refine(
          (value) => value.trim() === value,
          "Expected a trimmed label",
        ),
      })
      .strict(),
  ]);
}

function structure(exercise: ExerciseContent): ExerciseStructure {
  return exercise.kind === "quiz"
    ? {
        kind: "quiz",
        selectionMode: exercise.selectionMode,
        options: exercise.options.map((option) => ({
          id: option.id,
          correct: option.correct,
          explained: option.explanationMarkdown !== undefined,
        })),
      }
    : exercise;
}

/**
 * The reader body of a Material in a Content package: Markdown fragments with exercises
 * (`exercise-v1`) and step breaks (`step-breaks-v1`, content-studio#87) in place between them.
 * Exercise ids are unique in the material; a step break stands between two parts.
 */
export const readerBlocksSchema: z.ZodType<readonly ContentReaderBlock[]> = z
  .array(blockSchema())
  .superRefine((blocks, context) => {
    const ids = new Set<string>();
    blocks.forEach((value, index) => {
      if (value.kind === "markdown") return;
      if (value.kind === "step-break") {
        if (
          index === 0 ||
          index === blocks.length - 1 ||
          blocks[index - 1]?.kind === "step-break"
        )
          context.addIssue({
            code: "custom",
            path: [index],
            message: "A step break stands between two parts of the lesson",
          });
        return;
      }
      if (ids.has(value.id))
        context.addIssue({
          code: "custom",
          path: [index, "id"],
          message: `Duplicate exercise ID ${value.id}`,
        });
      ids.add(value.id);
      const issue = exerciseStructureIssue(structure(value));
      if (issue !== undefined)
        context.addIssue({ code: "custom", path: [index], message: issue });
    });
  });
