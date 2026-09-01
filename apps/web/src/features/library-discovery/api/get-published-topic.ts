import "server-only";

import {
  BackendConnectionError,
  requestPublishedTopic,
} from "@/shared/api/backend/index.server";

import type { PublishedTopicResult } from "../model/library-discovery-view";
import { mapLibraryDiscoveryResult } from "./map-library-discovery-result";

export async function getPublishedTopic(
  slug: string,
  accessToken?: string,
): Promise<PublishedTopicResult> {
  try {
    const result = await requestPublishedTopic(slug, {
      ...(accessToken === undefined ? {} : { accessToken }),
    });
    return mapLibraryDiscoveryResult(result, "topic");
  } catch (error) {
    if (error instanceof BackendConnectionError && error.code === "unavailable") {
      return { kind: "unavailable" };
    }
    throw error;
  }
}
