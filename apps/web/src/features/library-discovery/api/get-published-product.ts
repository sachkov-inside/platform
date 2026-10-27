import "server-only";

import {
  BackendConnectionError,
  requestPublishedProduct,
} from "@/shared/api/backend/index.server";

import type { PublishedProductResult } from "../model/library-discovery-view";
import { mapLibraryDiscoveryResult } from "./map-library-discovery-result";

export async function getPublishedProduct(
  slug: string,
  accessToken?: string,
): Promise<PublishedProductResult> {
  try {
    const result = await requestPublishedProduct(slug, {
      ...(accessToken === undefined ? {} : { accessToken }),
    });
    return mapLibraryDiscoveryResult(result, "product");
  } catch (error) {
    if (
      error instanceof BackendConnectionError &&
      error.code === "unavailable"
    ) {
      return { kind: "unavailable" };
    }
    throw error;
  }
}
