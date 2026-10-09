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
  return z
    .object({
      kind: z.literal("quiz"),
      id: z.string().trim().min(1),
      prompt: rich,
      correctOptionId: id,
      options: z
        .array(z.object({ id, content: rich, explanation: rich }).strict())
        .min(2)
        .max(5),
      dontKnow: z
        .object({
          explanation: rich,
          reviewLinks: z.array(z.string().min(2).startsWith("#")).min(1),
        })
        .strict(),
    })
    .strict()
    .refine(
      (quiz) =>
        new Set(quiz.options.map((option) => option.id)).size ===
        quiz.options.length,
      "Duplicate option IDs",
    )
    .refine(
      (quiz) =>
        quiz.options.some((option) => option.id === quiz.correctOptionId),
      "Invalid quiz key",
    );
}

// The recursive registry supplies the rendered schema; this lazy import-free reference is set
// through renderedSchema before document acceptance invokes field validation.
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
