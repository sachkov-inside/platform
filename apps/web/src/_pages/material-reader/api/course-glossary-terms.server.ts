import "server-only";

import { glossaryTermIdSchema } from "@inside/material-blocks";
import { z } from "zod";

import {
  BackendConnectionError,
  requestCourseGlossary,
} from "@/shared/api/backend/index.server";

/**
 * Термины, которые словарь курса показывает читателю: их вводит урок этого курса, который ему
 * открыт. «Подробнее» в подсказке ведёт в словарь только к ним, иначе раскрывает определение на
 * месте. Сбой чтения не мешает уроку: ссылок просто нет.
 */
export type CourseGlossaryTermsResult =
  | { readonly kind: "ready"; readonly termIds: readonly string[] }
  | { readonly kind: "not-found" }
  | { readonly kind: "unavailable" };

/** Нужны только идентификаторы; остальное тело словаря проверяет его страница. */
const courseGlossaryTermIdsSchema = z.object({
  terms: z.array(z.object({ id: glossaryTermIdSchema })),
});

export async function getCourseGlossaryTerms(
  slug: string,
  accessToken: string | undefined,
): Promise<CourseGlossaryTermsResult> {
  try {
    const result = await requestCourseGlossary(
      slug,
      accessToken === undefined ? {} : { accessToken },
    );
    if (!result.ok)
      return result.response.status === 404 || result.response.status === 400
        ? { kind: "not-found" }
        : { kind: "unavailable" };
    const parsed = courseGlossaryTermIdsSchema.safeParse(result.body);
    return parsed.success
      ? { kind: "ready", termIds: parsed.data.terms.map((term) => term.id) }
      : { kind: "unavailable" };
  } catch (error) {
    if (error instanceof BackendConnectionError) return { kind: "unavailable" };
    throw error;
  }
}
