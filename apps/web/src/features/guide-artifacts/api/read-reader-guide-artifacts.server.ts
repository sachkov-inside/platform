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
 * Reads the artifact section for one Guide as the current viewer.
 *
 * Both a failing dependency and an absent Guide degrade to `unavailable`. The
 * second is a contract inconsistency — the catalog just resolved this Guide by
 * id — but the reader gains nothing from losing the whole page over a section,
 * so the page keeps its programme and says the section is not opening. The
 * inconsistency stays visible in the backend request log, not in this adapter.
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
