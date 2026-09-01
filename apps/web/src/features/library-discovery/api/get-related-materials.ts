import "server-only";

import {
  BackendConnectionError,
  requestRelatedPublishedMaterials,
} from "@/shared/api/backend/index.server";

import type { RelatedMaterialsResult } from "../model/library-discovery-view";
import { mapLibraryDiscoveryResult } from "./map-library-discovery-result";

export async function getRelatedMaterials(
  slug: string,
  accessToken?: string,
): Promise<RelatedMaterialsResult> {
  try {
    const result = await requestRelatedPublishedMaterials(slug, {
      ...(accessToken === undefined ? {} : { accessToken }),
    });
    return mapLibraryDiscoveryResult(result, "related");
  } catch (error) {
    if (error instanceof BackendConnectionError && error.code === "unavailable") {
      return { kind: "unavailable" };
    }
    throw error;
  }
}
