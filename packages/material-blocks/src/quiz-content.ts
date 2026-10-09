import { z } from "zod";

const text = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, "Expected nonblank quiz text");
const id = text.refine(
  (value) => value !== "dontKnow",
  "Reserved quiz option ID",
);

export const quizContentSchema: z.ZodObject<{
  kind: z.ZodLiteral<"quiz">;
  id: z.ZodString;
  promptMarkdown: z.ZodString;
  correctOptionId: z.ZodString;
  options: z.ZodArray<
    z.ZodObject<{
      id: z.ZodString;
      markdown: z.ZodString;
      explanationMarkdown: z.ZodString;
    }>
  >;
  dontKnow: z.ZodObject<{
    explanationMarkdown: z.ZodString;
    reviewLinks: z.ZodArray<z.ZodString>;
  }>;
}> = z
  .object({
    kind: z.literal("quiz"),
    id: text,
    promptMarkdown: text,
    correctOptionId: id,
    options: z
      .array(
        z
          .object({
            id,
            markdown: text,
            explanationMarkdown: text,
          })
          .strict(),
      )
      .min(2)
      .max(5),
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
      .strict(),
  })
  .strict()
  .refine(
    (quiz) =>
      new Set(quiz.options.map((option) => option.id)).size ===
      quiz.options.length,
    "Duplicate quiz option IDs",
  )
  .refine(
    (quiz) => quiz.options.some((option) => option.id === quiz.correctOptionId),
    "Quiz key must identify one option",
  );

export type QuizContent = z.infer<typeof quizContentSchema>;
export const readerBlocksSchema: z.ZodArray<
  z.ZodUnion<
    readonly [
      z.ZodObject<{ kind: z.ZodLiteral<"markdown">; markdown: z.ZodString }>,
      typeof quizContentSchema,
    ]
  >
> = z
  .array(
    z.union([
      z.object({ kind: z.literal("markdown"), markdown: z.string() }).strict(),
      quizContentSchema,
    ]),
  )
  .refine((blocks) => {
    const ids = blocks.flatMap((block) =>
      block.kind === "quiz" ? [block.id] : [],
    );
    return new Set(ids).size === ids.length;
  }, "Duplicate quiz IDs");
export type ContentReaderBlock = z.infer<typeof readerBlocksSchema>[number];
