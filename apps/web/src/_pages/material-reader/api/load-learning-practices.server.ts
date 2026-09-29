import "server-only";
import { loadCourseAssistantParticipant } from "@/features/course-assistant-access.server";
import {
  BackendConnectionError,
  requestLearningPractices,
} from "@/shared/api/backend/index.server";
import {
  learningPracticesSchema,
  type LearningPracticesView,
} from "../model/learning-practice";

/** Always private/current; assignment versions never enter the cached guest lesson body. */
export async function loadLearningPractices(
  slug: string,
  accessToken: string,
): Promise<LearningPracticesView> {
  try {
    const result = await requestLearningPractices(slug, { accessToken });
    if (!result.ok)
      return result.response.status === 404
        ? { kind: "available", practices: [] }
        : { kind: "unavailable" };
    const parsed = learningPracticesSchema.safeParse(result.body);
    if (!parsed.success) return { kind: "unavailable" };
    const { practices } = parsed.data;
    // Закрытый помощник отвечает 404: кнопки проверки нет, остальной путь #785 не меняется.
    const assistant =
      practices.length > 0 &&
      (await loadCourseAssistantParticipant(accessToken)).kind === "ready";
    return { kind: "available", practices, assistant };
  } catch (error) {
    if (error instanceof BackendConnectionError) return { kind: "unavailable" };
    throw error;
  }
}
