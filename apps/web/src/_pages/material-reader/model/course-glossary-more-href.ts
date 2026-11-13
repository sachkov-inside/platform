import type { Route } from "next";

import { courseGlossaryHref } from "@/shared/routing/subscription-route";

/** Словарь курса, внутри которого открыт урок, и термины, которые он показывает этому читателю. */
export interface ReaderCourseGlossary {
  readonly slug: string;
  readonly termIds: readonly string[];
}

/**
 * Куда ведёт «Подробнее» подсказки термина. К карточке в словаре курса, только если словарь её
 * показывает читателю; иначе ссылки нет, и подсказка раскрывает определение на месте.
 */
export function courseGlossaryMoreHref(
  glossary: ReaderCourseGlossary | undefined,
): ((termId: string) => Route | undefined) | undefined {
  if (glossary === undefined) return undefined;
  const listed = new Set(glossary.termIds);
  return (termId) =>
    listed.has(termId) ? courseGlossaryHref(glossary.slug, termId) : undefined;
}
