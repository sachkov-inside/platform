import type { Route } from "next";
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

/**
 * Термин в теле урока. `moreHref` ведёт «Подробнее» подсказки к термину на странице словаря курса;
 * без него подсказка раскрывает полное определение на месте.
 */
export interface GlossaryTermReading extends GlossaryTerm {
  readonly moreHref?: Route | undefined;
}

/** Термины урока по идентификатору: тело ссылается на них `term:<id>` и карточкой определения. */
export type GlossaryTerms = ReadonlyMap<string, GlossaryTermReading>;

export function glossaryTermsById(
  terms: readonly GlossaryTerm[],
  moreHref?: (termId: string) => Route,
): GlossaryTerms {
  return new Map(
    terms.map((term) => [
      term.id,
      moreHref === undefined ? term : { ...term, moreHref: moreHref(term.id) },
    ]),
  );
}

/** Полное определение хранится простым текстом; пустая строка разделяет абзацы. */
export function glossaryDefinitionParagraphs(text: string): readonly string[] {
  return text
    .split(/\n\s*\n/u)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);
}
