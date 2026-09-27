import "server-only";
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
    return parsed.success
      ? { kind: "available", practices: parsed.data.practices }
      : { kind: "unavailable" };
  } catch (error) {
    if (error instanceof BackendConnectionError) return { kind: "unavailable" };
    throw error;
  }
}
