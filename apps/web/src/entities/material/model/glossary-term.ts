import { z } from "zod";

/**
 * Термин словаря, как его отдаёт чтение урока вместе с телом: определения берутся из словаря при
 * чтении, поэтому исправленное определение видно во всех уроках без перепубликации.
 */
export const glossaryTermSchema = z.object({
  id: z.string(),
  title: z.string(),
  englishTitle: z.string().nullable(),
  shortDefinition: z.string(),
  fullDefinition: z.string(),
});

export type GlossaryTerm = z.infer<typeof glossaryTermSchema>;

/** Термины урока по идентификатору: тело ссылается на них `term:<id>` и карточкой определения. */
export type GlossaryTerms = ReadonlyMap<string, GlossaryTerm>;

export function glossaryTermsById(
  terms: readonly GlossaryTerm[],
): GlossaryTerms {
  return new Map(terms.map((term) => [term.id, term]));
}

/** Полное определение хранится простым текстом; пустая строка разделяет абзацы. */
export function glossaryDefinitionParagraphs(text: string): readonly string[] {
  return text
    .split(/\n\s*\n/u)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);
}
