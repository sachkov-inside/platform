import "server-only";

import { applyCatalogCachePolicy } from "@/shared/api/catalog-cache.server";

import {
  getCourseGlossaryTerms,
  type CourseGlossaryTermsResult,
} from "./course-glossary-terms.server";

/** Термины словаря курса глазами гостя из общего кеша: запрос идёт без токена (ADR 0027). */
export async function readPublicCourseGlossaryTerms(
  slug: string,
): Promise<CourseGlossaryTermsResult> {
  "use cache";
  const result = await getCourseGlossaryTerms(slug, undefined);
  applyCatalogCachePolicy(result.kind);
  return result;
}
