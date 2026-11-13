import { glossaryTermIdSchema } from "@inside/material-blocks";
import { z } from "zod";

/** «Знаю» or «повторить»: a reader's own mark on a term of the lesson deck. */
export const glossaryTermMarkValueSchema = z.enum(["known", "review"]);
export type GlossaryTermMarkValue = z.output<
  typeof glossaryTermMarkValueSchema
>;

/** A deck reads the marks of its own terms; one lesson introduces far fewer. */
export const GLOSSARY_MARKS_QUERY_MAX = 100;

export const glossaryTermMarkSchema = z
  .object({
    termId: glossaryTermIdSchema,
    mark: glossaryTermMarkValueSchema,
    markedAt: z.iso.datetime(),
  })
  .strict();

export type GlossaryTermMark = z.output<typeof glossaryTermMarkSchema>;
