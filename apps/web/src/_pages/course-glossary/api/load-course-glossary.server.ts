import "server-only";

import {
  BackendConnectionError,
  requestCourseGlossary,
} from "@/shared/api/backend/index.server";

import {
  courseGlossarySchema,
  type CourseGlossaryResult,
} from "../model/course-glossary";

/**
 * Словарь курса глазами читателя: термины урока, который ему закрыт, сюда не попадают. Ответ
 * личный, поэтому он не кешируется и в предзагрузку не идёт.
 */
export async function loadCourseGlossary(
  slug: string,
  accessToken: string | undefined,
): Promise<CourseGlossaryResult> {
  try {
    const result = await requestCourseGlossary(
      slug,
      accessToken === undefined ? {} : { accessToken },
    );
    if (!result.ok)
      return result.response.status === 404 || result.response.status === 400
        ? { kind: "not-found" }
        : { kind: "unavailable" };
    const parsed = courseGlossarySchema.safeParse(result.body);
    return parsed.success
      ? { kind: "ready", ...parsed.data }
      : { kind: "unavailable" };
  } catch (error) {
    if (error instanceof BackendConnectionError) return { kind: "unavailable" };
    throw error;
  }
}
