import { glossaryTermIdSchema } from "@inside/material-blocks";
import { z } from "zod";

/** «Знаю» или «повторить»: личная отметка читателя на карточке колоды. */
export const termMarkValueSchema = z.enum(["known", "review"]);
export type TermMarkValue = z.infer<typeof termMarkValueSchema>;

export const termMarkSchema = z
  .object({
    termId: glossaryTermIdSchema,
    mark: termMarkValueSchema,
    markedAt: z.iso.datetime(),
  })
  .strict();
export type TermMark = z.infer<typeof termMarkSchema>;

/** Колода спрашивает отметки своих терминов; урок вводит их куда меньше сотни. */
export const TERM_MARKS_QUERY_MAX = 100;

export const termMarksResultSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("ready"),
      marks: z.array(termMarkSchema).max(TERM_MARKS_QUERY_MAX),
    })
    .strict(),
  z.object({ kind: z.literal("unauthorized") }).strict(),
  z.object({ kind: z.literal("unavailable") }).strict(),
  z.object({ kind: z.literal("invalid_input") }).strict(),
]);

export const termMarkResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ready"), mark: termMarkSchema }).strict(),
  z.object({ kind: z.literal("unauthorized") }).strict(),
  z.object({ kind: z.literal("unavailable") }).strict(),
  z.object({ kind: z.literal("invalid_input") }).strict(),
]);

export const termMarkCommandSchema = z
  .object({
    termId: glossaryTermIdSchema,
    mark: termMarkValueSchema,
  })
  .strict();
export type TermMarkCommand = z.infer<typeof termMarkCommandSchema>;

export type TermMarksResult =
  | { readonly kind: "ready"; readonly marks: readonly TermMark[] }
  | { readonly kind: "unauthorized" }
  | { readonly kind: "unavailable" };

export type TermMarkResult =
  | { readonly kind: "ready"; readonly mark: TermMark }
  | { readonly kind: "unauthorized" }
  | { readonly kind: "unavailable" };
