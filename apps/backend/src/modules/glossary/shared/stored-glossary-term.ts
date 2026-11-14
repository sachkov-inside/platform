import type { GlossaryTerm } from "../domain/glossary-term.js";

/** A stored row as the domain term; the row's timestamps stay inside the Module. */
export function storedGlossaryTerm(row: {
  readonly id: string;
  readonly title: string;
  readonly englishTitle: string | null;
  readonly shortDefinition: string;
  readonly fullDefinition: string;
  readonly introducedInSourceId: string | null;
}): GlossaryTerm {
  return {
    id: row.id,
    title: row.title,
    englishTitle: row.englishTitle,
    shortDefinition: row.shortDefinition,
    fullDefinition: row.fullDefinition,
    introducedInSourceId: row.introducedInSourceId,
  };
}
