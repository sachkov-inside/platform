import { z } from "zod";
import {
  defineMaterialBlock,
  type MaterialBlockDefinition,
  type MaterialBlockTextTools,
  type RenderedBlockVariantSchema,
} from "../block-definition.js";
import { nodeAttributes } from "../document-node.js";
import {
  exerciseIdSchema,
  exerciseRevealSchema,
  exerciseStructureIssue,
  isExerciseKind,
  type ExerciseKind,
  type ExerciseStructure,
} from "../exercise-rules.js";
import type {
  RenderedBlock,
  RenderedExercise,
  RenderedMatch,
  RenderedOrder,
  RenderedQuiz,
} from "../rendered-block.js";
// The lazy recursive schema is evaluated only when an accepted node is rendered or validated.
import { renderedBlockSchema } from "../rendered-block-schema.js";

/** Rich exercise text: rendered blocks, never another exercise or a step break. */
function richSchema(block: z.ZodType<RenderedBlock>) {
  return z
    .array(block)
    .min(1)
    .refine(
      (blocks) =>
        blocks.every(
          (value) => !isExerciseKind(value.kind) && value.kind !== "step_break",
        ),
      "Nested exercise is unsupported",
    );
}

function commonShape(block: z.ZodType<RenderedBlock>) {
  const rich = richSchema(block);
  return {
    id: exerciseIdSchema,
    reveal: exerciseRevealSchema,
    context: rich.optional(),
    question: rich,
    dontKnow: z
      .object({
        explanation: rich,
        reviewLinks: z.array(z.string().min(2).startsWith("#")).min(1),
      })
      .strict()
      .optional(),
  };
}

function structured<Block extends RenderedExercise>(
  schema: z.ZodObject,
  structure: (exercise: Block) => ExerciseStructure,
): RenderedBlockVariantSchema<Block> {
  const refined = schema.superRefine((value, context) => {
    // The object schema parsed `value`, so it has the shape of `Block`.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const issue = exerciseStructureIssue(structure(value as Block));
    if (issue !== undefined)
      context.addIssue({ code: "custom", message: issue });
  });
  // The object schema carries the `kind` literal; the refinement keeps it discriminable.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return refined as unknown as RenderedBlockVariantSchema<Block>;
}

function quizSchema(block: z.ZodType<RenderedBlock>) {
  const rich = richSchema(block);
  return structured<RenderedQuiz>(
    z
      .object({
        kind: z.literal("quiz"),
        ...commonShape(block),
        selectionMode: z.enum(["single", "multiple"]),
        options: z.array(
          z
            .object({
              id: exerciseIdSchema,
              content: rich,
              correct: z.boolean(),
              explanation: rich.optional(),
            })
            .strict(),
        ),
      })
      .strict(),
    (quiz) => ({
      kind: "quiz",
      selectionMode: quiz.selectionMode,
      options: quiz.options.map((option) => ({
        id: option.id,
        correct: option.correct,
        explained: option.explanation !== undefined,
      })),
    }),
  );
}

function matchSchema(block: z.ZodType<RenderedBlock>) {
  const rich = richSchema(block);
  return structured<RenderedMatch>(
    z
      .object({
        kind: z.literal("match"),
        ...commonShape(block),
        mode: z.enum(["pairs", "groups"]),
        rows: z.array(
          z
            .object({
              id: exerciseIdSchema,
              content: rich,
              answerId: exerciseIdSchema,
              explanation: rich,
            })
            .strict(),
        ),
        choices: z.array(
          z.object({ id: exerciseIdSchema, content: rich }).strict(),
        ),
      })
      .strict(),
    (match) => match,
  );
}

function orderSchema(block: z.ZodType<RenderedBlock>) {
  const rich = richSchema(block);
  return structured<RenderedOrder>(
    z
      .object({
        kind: z.literal("order"),
        ...commonShape(block),
        steps: z.array(
          z
            .object({ id: exerciseIdSchema, content: rich, explanation: rich })
            .strict(),
        ),
      })
      .strict(),
    (order) => order,
  );
}

type Rich = readonly RenderedBlock[];

/** Every rich part of an exercise in reading order: asset hydration and safety checks walk it. */
function exerciseChildren(exercise: RenderedExercise): Rich {
  const items: Rich = (() => {
    switch (exercise.kind) {
      case "quiz":
        return exercise.options.flatMap((option) => [
          ...option.content,
          ...(option.explanation ?? []),
        ]);
      case "match":
        return [
          ...exercise.rows.flatMap((row) => [
            ...row.content,
            ...row.explanation,
          ]),
          ...exercise.choices.flatMap((choice) => choice.content),
        ];
      case "order":
        return exercise.steps.flatMap((step) => [
          ...step.content,
          ...step.explanation,
        ]);
    }
  })();
  return [
    ...(exercise.context ?? []),
    ...exercise.question,
    ...items,
    ...(exercise.dontKnow?.explanation ?? []),
  ];
}

function mapExercise<Block extends RenderedExercise>(
  exercise: Block,
  map: (child: RenderedBlock) => RenderedBlock,
): Block {
  const rich = (blocks: Rich): Rich => blocks.map(map);
  const common = {
    ...(exercise.context === undefined
      ? {}
      : { context: rich(exercise.context) }),
    question: rich(exercise.question),
    ...(exercise.dontKnow === undefined
      ? {}
      : {
          dontKnow: {
            ...exercise.dontKnow,
            explanation: rich(exercise.dontKnow.explanation),
          },
        }),
  };
  const mapped: RenderedExercise = (() => {
    // The switch narrows a copy; `exercise` keeps its generic type for the result.
    const value: RenderedExercise = exercise;
    switch (value.kind) {
      case "quiz":
        return {
          ...value,
          ...common,
          options: value.options.map((option) => ({
            ...option,
            content: rich(option.content),
            ...(option.explanation === undefined
              ? {}
              : { explanation: rich(option.explanation) }),
          })),
        };
      case "match":
        return {
          ...value,
          ...common,
          rows: value.rows.map((row) => ({
            ...row,
            content: rich(row.content),
            explanation: rich(row.explanation),
          })),
          choices: value.choices.map((choice) => ({
            ...choice,
            content: rich(choice.content),
          })),
        };
      case "order":
        return {
          ...value,
          ...common,
          steps: value.steps.map((step) => ({
            ...step,
            content: rich(step.content),
            explanation: rich(step.explanation),
          })),
        };
    }
  })();
  // `mapped` keeps the kind of `exercise`, so it is the same variant.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return mapped as Block;
}

function exerciseText(
  exercise: RenderedExercise,
  tools: MaterialBlockTextTools,
): string {
  return [...(exercise.context ?? []), ...exercise.question]
    .map(tools.blockText)
    .join("\n\n");
}

const kindLabels: Readonly<Record<ExerciseKind, string>> = {
  quiz: "Квиз",
  match: "«Сопоставь»",
  order: "«Расставь по порядку»",
};

/**
 * One Lesson Exercise kind as an atom node. Content (`content-studio`) owns the exercise: the
 * whole rendered value lives in the `exercise` attribute and the editor shows it read-only.
 */
function exerciseBlock<Kind extends ExerciseKind>(
  kind: Kind,
  schema: (
    block: z.ZodType<RenderedBlock>,
  ) => RenderedBlockVariantSchema<Extract<RenderedExercise, { kind: Kind }>>,
): MaterialBlockDefinition {
  return defineMaterialBlock<Kind>({
    kind,
    type: kind,
    node: {
      atom: true,
      attributes: { exercise: null },
      group: "block",
      domAttributes: { exercise: "data-exercise" },
      parseHTML: [`div[data-material-block="${kind}"]`],
      renderHTML: (attributes) => [
        "div",
        { ...attributes, "data-material-block": kind },
        `${kindLabels[kind]} из Content`,
      ],
    },
    issues: (node, report) => {
      if (
        !schema(renderedBlockSchema).safeParse(nodeAttributes(node)["exercise"])
          .success
      )
        report("invalid_exercise", "exercise");
    },
    render: (node) =>
      schema(renderedBlockSchema).parse(nodeAttributes(node)["exercise"]),
    renderedSchema: schema,
    // Search sees the condition and the question only: answers and explanations stay out.
    text: exerciseText,
    children: exerciseChildren,
    mapChildren: mapExercise,
  });
}

export const quizBlock: MaterialBlockDefinition = exerciseBlock(
  "quiz",
  quizSchema,
);
export const matchBlock: MaterialBlockDefinition = exerciseBlock(
  "match",
  matchSchema,
);
export const orderBlock: MaterialBlockDefinition = exerciseBlock(
  "order",
  orderSchema,
);
