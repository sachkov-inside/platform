import { z } from "zod";
import {
  defineMaterialBlock,
  type MaterialBlockDefinition,
} from "../block-definition.js";
import { nodeAttributes } from "../document-node.js";
import type { RenderedBlock, RenderedQuiz } from "../rendered-block.js";

function quizSchema(block: z.ZodType<RenderedBlock>) {
  const rich = z
    .array(block)
    .min(1)
    .refine(
      (blocks) => blocks.every((value) => value.kind !== "quiz"),
      "Nested quiz is unsupported",
    );
  const id = z
    .string()
    .trim()
    .min(1)
    .refine((value) => value !== "dontKnow", "Reserved quiz option ID");
  const common = {
    kind: z.literal("quiz"),
    id: z.string().trim().min(1),
    prompt: rich,
    dontKnow: z
      .object({
        explanation: rich,
        reviewLinks: z.array(z.string().min(2).startsWith("#")).min(1),
      })
      .strict(),
  };
  const option = z.object({ id, content: rich, explanation: rich }).strict();
  return z
    .discriminatedUnion("selectionMode", [
      z
        .object({
          ...common,
          selectionMode: z.literal(undefined).optional(),
          correctOptionId: id,
          options: z.array(option).min(2).max(5),
        })
        .strict(),
      z
        .object({
          ...common,
          selectionMode: z.literal("multiple"),
          correctOptionIds: z.array(id).min(1).max(8),
          options: z.array(option).min(2).max(8),
        })
        .strict(),
    ])
    .refine(
      (quiz) =>
        new Set(quiz.options.map((option) => option.id)).size ===
        quiz.options.length,
      "Duplicate option IDs",
    )
    .refine((quiz) => {
      const keys =
        quiz.selectionMode === "multiple"
          ? quiz.correctOptionIds
          : [quiz.correctOptionId];
      return (
        new Set(keys).size === keys.length &&
        keys.every((key) => quiz.options.some((option) => option.id === key))
      );
    }, "Invalid quiz keys");
}

// The lazy recursive schema is evaluated only when an accepted node is rendered or validated.
import { renderedBlockSchema } from "../rendered-block-schema.js";

export const quizBlock: MaterialBlockDefinition = defineMaterialBlock<"quiz">({
  kind: "quiz",
  type: "quiz",
  node: {
    atom: true,
    attributes: { quiz: null },
    group: "block",
    domAttributes: { quiz: "data-quiz" },
    parseHTML: ['div[data-material-block="quiz"]'],
    renderHTML: (attributes) => [
      "div",
      { ...attributes, "data-material-block": "quiz" },
      "Квиз из Content",
    ],
  },
  issues: (node, report) => {
    if (
      !quizSchema(renderedBlockSchema).safeParse(nodeAttributes(node)["quiz"])
        .success
    )
      report("invalid_quiz", "quiz");
  },
  render: (node) =>
    quizSchema(renderedBlockSchema).parse(nodeAttributes(node)["quiz"]),
  renderedSchema: quizSchema,
  text: (quiz, tools) => quiz.prompt.map(tools.blockText).join("\n\n"),
  children: (quiz) => [
    ...quiz.prompt,
    ...quiz.options.flatMap((option) => [
      ...option.content,
      ...option.explanation,
    ]),
    ...quiz.dontKnow.explanation,
  ],
  mapChildren: (quiz, map): RenderedQuiz => ({
    ...quiz,
    prompt: quiz.prompt.map(map),
    options: quiz.options.map((option) => ({
      ...option,
      content: option.content.map(map),
      explanation: option.explanation.map(map),
    })),
    dontKnow: {
      ...quiz.dontKnow,
      explanation: quiz.dontKnow.explanation.map(map),
    },
  }),
});
