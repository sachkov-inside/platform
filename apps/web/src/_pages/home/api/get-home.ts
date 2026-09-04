import "server-only";

import { z } from "zod";

import {
  contentCoverSchema,
  publishedMaterialProjectionSchema,
  toMaterialPreview,
} from "@/entities/material";
import {
  BackendConnectionError,
  requestHomeContent,
} from "@/shared/api/backend/index.server";
import { dependencyUnavailableProblemSchema } from "@/shared/api/problem-details";
import type { HomeResult } from "../model/home-view";

const homeCollectionSchema = z
  .object({
    count: z.number().int().nonnegative(),
    cover: contentCoverSchema.nullable(),
    id: z.uuid(),
    name: z.string(),
    previewItems: z.array(publishedMaterialProjectionSchema),
    slug: z.string(),
    summary: z.string().nullable(),
  })
  .strict();

const homeSchema = z
  .object({
    guides: z.array(publishedMaterialProjectionSchema),
    notes: z.array(publishedMaterialProjectionSchema),
    playlists: z.array(homeCollectionSchema),
    topics: z.array(homeCollectionSchema),
    videos: z.array(publishedMaterialProjectionSchema),
  })
  .strict();

export async function getHome(
  accessToken?: string,
): Promise<HomeResult> {
  let result: Awaited<ReturnType<typeof requestHomeContent>>;
  try {
    result = await requestHomeContent(
      accessToken === undefined ? {} : { accessToken },
    );
  } catch (error) {
    if (error instanceof BackendConnectionError && error.code === "unavailable") {
      return { kind: "unavailable" };
    }
    throw error;
  }
  if (!result.ok) {
    if (dependencyUnavailableProblemSchema.safeParse(result.problem).success) {
      return { kind: "unavailable" };
    }
    throw new BackendConnectionError(
      "backend-error",
      `Home request returned ${String(result.response.status)}`,
    );
  }
  const parsed = homeSchema.safeParse(result.body);
  if (!parsed.success) {
    throw new BackendConnectionError(
      "invalid-response",
      "Home response does not match the contract",
      { cause: parsed.error },
    );
  }
  return {
    kind: "ready",
    value: {
      guides: parsed.data.guides.map(toMaterialPreview),
      notes: parsed.data.notes.map(toMaterialPreview),
      playlists: parsed.data.playlists.map(mapCollection),
      topics: parsed.data.topics.map(mapCollection),
      videos: parsed.data.videos.map(toMaterialPreview),
    },
  };
}

function mapCollection(collection: z.infer<typeof homeCollectionSchema>) {
  return {
    ...collection,
    previewItems: collection.previewItems.map(toMaterialPreview),
  };
}
