import "server-only";

import {
  BackendConnectionError,
  requestReaderProductArtifacts,
} from "@/shared/api/backend/index.server";
import { dependencyUnavailableProblemSchema } from "@/shared/api/problem-details";

import {
  readerProductArtifactListSchema,
  type ReaderProductArtifactsResult,
} from "../model/reader-product-artifacts";

/**
 * Reads the artifact section for one Product as the current viewer.
 *
 * Both a failing dependency and an absent Product degrade to `unavailable`. The
 * second is a contract inconsistency — the catalog just resolved this Product by
 * id — but the reader gains nothing from losing the whole page over a section,
 * so the page keeps its programme and says the section is not opening. The
 * inconsistency stays visible in the backend request log, not in this adapter.
 */
export async function readReaderProductArtifacts(
  productId: string,
  accessToken?: string,
): Promise<ReaderProductArtifactsResult> {
  let result;
  try {
    result = await requestReaderProductArtifacts(productId, {
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
      `Product artifact section request returned ${String(result.response.status)}`,
    );
  }
  const parsed = readerProductArtifactListSchema.safeParse(result.body);
  if (!parsed.success) {
    throw new BackendConnectionError(
      "invalid-response",
      "Product artifact section response does not match the contract",
      { cause: parsed.error },
    );
  }
  return { artifacts: parsed.data.artifacts, kind: "ready" };
}
