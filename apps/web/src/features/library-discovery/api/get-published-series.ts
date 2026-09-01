import "server-only";

import {
  BackendConnectionError,
  requestPublishedSeries,
} from "@/shared/api/backend/index.server";

import type { PublishedSeriesResult } from "../model/library-discovery-view";
import { mapLibraryDiscoveryResult } from "./map-library-discovery-result";

export async function getPublishedSeries(
  slug: string,
  accessToken?: string,
): Promise<PublishedSeriesResult> {
  try {
    const result = await requestPublishedSeries(slug, {
      ...(accessToken === undefined ? {} : { accessToken }),
    });
    return mapLibraryDiscoveryResult(result, "series");
  } catch (error) {
    if (error instanceof BackendConnectionError && error.code === "unavailable") {
      return { kind: "unavailable" };
    }
    throw error;
  }
}
