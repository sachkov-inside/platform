import { z } from "zod";

const text = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, "Expected nonblank quiz text");
const id = text.refine(
  (value) => value !== "dontKnow",
  "Reserved quiz option ID",
);

type CommonShape = {
  kind: z.ZodLiteral<"quiz">;
  id: z.ZodString;
  promptMarkdown: z.ZodString;
  dontKnow: z.ZodObject<{
    explanationMarkdown: z.ZodString;
    reviewLinks: z.ZodArray<z.ZodString>;
  }>;
};
type OptionSchema = z.ZodObject<{
  id: z.ZodString;
  markdown: z.ZodString;
  explanationMarkdown: z.ZodString;
}>;
type SingleSchema = z.ZodObject<
  CommonShape & {
    correctOptionId: z.ZodString;
    options: z.ZodArray<OptionSchema>;
  }
>;
type MultipleSchema = z.ZodObject<
  CommonShape & {
    selectionMode: z.ZodLiteral<"multiple">;
    correctOptionIds: z.ZodArray<z.ZodString>;
    options: z.ZodArray<OptionSchema>;
  }
>;
const common: CommonShape = {
  kind: z.literal("quiz"),
  id: text,
  promptMarkdown: text,
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
};
const option: OptionSchema = z
  .object({ id, markdown: text, explanationMarkdown: text })
  .strict();
const single: SingleSchema = z
  .object({
    ...common,
    correctOptionId: id,
    options: z.array(option).min(2).max(5),
  })
  .strict();
const multiple: MultipleSchema = z
  .object({
    ...common,
    selectionMode: z.literal("multiple"),
    correctOptionIds: z.array(id).min(1).max(8),
    options: z.array(option).min(2).max(8),
  })
  .strict();
export const quizContentSchema: z.ZodUnion<
  readonly [SingleSchema, MultipleSchema]
> = z
  .union([single, multiple])
  .refine(
    (quiz) =>
      new Set(quiz.options.map((option) => option.id)).size ===
      quiz.options.length,
    "Duplicate quiz option IDs",
  )
  .refine((quiz) => {
    const keys =
      "selectionMode" in quiz ? quiz.correctOptionIds : [quiz.correctOptionId];
    return (
      new Set(keys).size === keys.length &&
      keys.every((key) => quiz.options.some((option) => option.id === key))
    );
  }, "Quiz keys must identify distinct options");

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
