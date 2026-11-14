import "server-only";

import { readPublicCourseGlossaryTerms } from "./course-glossary-terms.public-cache.server";
import {
  getCourseGlossaryTerms,
  type CourseGlossaryTermsResult,
} from "./course-glossary-terms.server";

/** Гость и общая часть урока читают кеш; вошедший получает свой словарь. */
export function readCourseGlossaryTerms(
  slug: string,
  accessToken?: string,
): Promise<CourseGlossaryTermsResult> {
  return accessToken === undefined
    ? readPublicCourseGlossaryTerms(slug)
    : getCourseGlossaryTerms(slug, accessToken);
}
