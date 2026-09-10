import "server-only";

import {
  BackendConnectionError,
  requestReaderGuideArtifacts,
} from "@/shared/api/backend/index.server";
import { dependencyUnavailableProblemSchema } from "@/shared/api/problem-details";

import {
  readerGuideArtifactListSchema,
  type ReaderGuideArtifactsResult,
} from "../model/reader-guide-artifacts";

/**
 * Reads the artifact section for one Guide as the current viewer. A Guide the
 * catalog already resolved always exists here, so an absent section and a
 * failing dependency are the same thing to the page: it renders without it.
 */
export async function readReaderGuideArtifacts(
  guideId: string,
  accessToken?: string,
): Promise<ReaderGuideArtifactsResult> {
  let result;
  try {
    result = await requestReaderGuideArtifacts(guideId, {
      ...(accessToken === undefined ? {} : { accessToken }),
    });
  } catch (error) {
    if (error instanceof BackendConnectionError) return { kind: "unavailable" };
    throw error;
  }
  if (!result.ok) {
    if (
      result.response.status === 404 ||
      dependencyUnavailableProblemSchema.safeParse(result.problem).success
    ) {
      return { kind: "unavailable" };
    }
    throw new BackendConnectionError(
      "backend-error",
      `Guide artifact section request returned ${String(result.response.status)}`,
    );
  }
  const parsed = readerGuideArtifactListSchema.safeParse(result.body);
  if (!parsed.success) {
    throw new BackendConnectionError(
      "invalid-response",
      "Guide artifact section response does not match the contract",
      { cause: parsed.error },
    );
  }
  return { artifacts: parsed.data.artifacts, kind: "ready" };
}
